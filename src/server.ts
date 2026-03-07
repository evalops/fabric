/**
 * Fabric API Server
 *
 * HTTP + WebSocket server for running Fabric without Electron.
 * Exposes REST endpoints for goal CRUD, observability queries, and real-time
 * event streaming via WebSocket.
 */

import * as http from "http";
import * as url from "url";
import { FabricEngine, FabricEvent } from "./fabric";
import { FabricDB } from "./db/persistence";
import { createWebhookExtension, WebhookConfig } from "./extensions/webhook";

// ── Configuration ─────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3000", 10);
const DATABASE_URL = process.env.DATABASE_URL;
const MAX_BODY_BYTES = 1024 * 64; // 64KB max request body
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "120", 10);

// ── Rate Limiter ─────────────────────────────────────

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= RATE_LIMIT_MAX;
}

// Periodic cleanup of expired buckets
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now >= bucket.resetAt) rateBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS);

// ── Request Metrics ──────────────────────────────────

const serverMetrics = {
  requestCount: 0,
  errorCount: 0,
  activeConnections: 0,
  sseClients: 0,
  startedAt: Date.now(),
};

// ── Init ──────────────────────────────────────────────

const engine = new FabricEngine();
const db = DATABASE_URL ? new FabricDB(DATABASE_URL) : null;

// Track connected SSE clients
const wsClients = new Set<import("http").ServerResponse>();

// Persist events to database and broadcast to WS clients
engine.on("fabric-event", async (event: FabricEvent) => {
  // Broadcast to all WebSocket clients
  for (const client of wsClients) {
    try {
      client.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      wsClients.delete(client);
    }
  }

  // Persist to database
  if (!db) return;
  try {
    switch (event.type) {
      case "goal-created":
      case "goal-updated":
        await db.upsertGoal(event.data);
        if (event.data.steps?.length) {
          await db.upsertSteps(event.data.id, event.data.steps);
        }
        break;
      case "tool-call":
        await db.insertToolCall(event.data);
        break;
      case "cost-update":
        if (event.goalId) {
          await db.insertCostEvent(
            event.goalId,
            event.data.costUsd,
            event.data.inputTokens,
            event.data.outputTokens
          );
        }
        break;
      case "activity":
        await db.insertActivity(
          event.goalId || null,
          event.type,
          event.data.text,
          "system"
        );
        break;
    }
  } catch (err) {
    console.error("DB persistence error:", err);
  }
});

// ── HTTP Router ───────────────────────────────────────

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    req.on("data", (chunk: Buffer | string) => {
      bytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`));
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, data: any, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function notFound(res: http.ServerResponse): void {
  json(res, { error: "Not found" }, 404);
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const parsed = url.parse(req.url || "", true);
  const path = parsed.pathname || "/";
  const method = req.method || "GET";
  serverMetrics.requestCount++;

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  // Rate limiting (skip SSE and health)
  if (path !== "/events" && path !== "/health") {
    const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      || req.socket.remoteAddress || "unknown";
    if (!checkRateLimit(clientIp)) {
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
      res.end(JSON.stringify({ error: "Rate limit exceeded. Try again later." }));
      return;
    }
  }

  // ── SSE Event Stream ─────────────────────────────
  if (path === "/events" && method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    wsClients.add(res);
    serverMetrics.sseClients = wsClients.size;

    // SSE heartbeat to prevent proxy timeouts (every 30s)
    const heartbeat = setInterval(() => {
      try { res.write(":heartbeat\n\n"); } catch { clearInterval(heartbeat); }
    }, 30_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      wsClients.delete(res);
      serverMetrics.sseClients = wsClients.size;
    });
    return;
  }

  // ── Health ────────────────────────────────────────
  if (path === "/health") {
    json(res, { status: "ok", goals: engine.getGoals().length, db: !!db });
    return;
  }

  // ── Server Stats ──────────────────────────────────
  if (path === "/api/server/stats" && method === "GET") {
    const uptimeMs = Date.now() - serverMetrics.startedAt;
    json(res, {
      uptime_seconds: Math.round(uptimeMs / 1000),
      requests_total: serverMetrics.requestCount,
      errors_total: serverMetrics.errorCount,
      sse_clients: serverMetrics.sseClients,
      active_goals: engine.getGoals().filter(g => g.status === "active").length,
      total_goals: engine.getGoals().length,
      rate_limit_max: RATE_LIMIT_MAX,
      db_connected: !!db,
    });
    return;
  }

  // ── Goal Routes ───────────────────────────────────

  // GET /api/goals
  if (path === "/api/goals" && method === "GET") {
    if (db) {
      const status = parsed.query.status as string | undefined;
      const limit = parseInt(parsed.query.limit as string) || 50;
      const offset = parseInt(parsed.query.offset as string) || 0;
      const goals = await db.listGoals({ status, limit, offset });
      json(res, goals);
    } else {
      json(res, engine.getGoals());
    }
    return;
  }

  // GET /api/goals/:id
  const goalMatch = path.match(/^\/api\/goals\/([^/]+)$/);
  if (goalMatch && method === "GET") {
    const id = goalMatch[1];
    if (db) {
      const goal = await db.getGoal(id);
      if (!goal) return notFound(res);
      const steps = await db.getSteps(id);
      json(res, { ...goal, steps });
    } else {
      const goal = engine.getGoal(id);
      if (!goal) return notFound(res);
      json(res, goal);
    }
    return;
  }

  // POST /api/goals — Create a new goal (supports per-goal model override)
  if (path === "/api/goals" && method === "POST") {
    const body = await parseBody(req);
    if (!body.description) {
      json(res, { error: "description is required" }, 400);
      return;
    }
    const id = await engine.createGoal({
      description: body.description,
      model: body.model,
      maxBudgetUsd: body.maxBudgetUsd,
      maxTurns: body.maxTurns,
    });
    json(res, { id, status: "created" }, 201);
    return;
  }

  // POST /api/goals/batch — Create multiple goals at once
  if (path === "/api/goals/batch" && method === "POST") {
    const body = await parseBody(req);
    if (!Array.isArray(body.descriptions) || body.descriptions.length === 0) {
      json(res, { error: "descriptions array is required" }, 400);
      return;
    }
    if (body.descriptions.length > 20) {
      json(res, { error: "maximum 20 goals per batch" }, 400);
      return;
    }
    const result = await engine.createBatchGoals(body.descriptions, {
      model: body.model,
      maxBudgetUsd: body.maxBudgetUsd,
      maxTurns: body.maxTurns,
    });
    json(res, result, 201);
    return;
  }

  // POST /api/goals/:id/pause — Pause a goal
  const pauseMatch = path.match(/^\/api\/goals\/([^/]+)\/pause$/);
  if (pauseMatch && method === "POST") {
    engine.pauseGoal(pauseMatch[1]);
    json(res, { status: "paused" });
    return;
  }

  // POST /api/goals/:id/resume — Resume a paused goal
  const resumeMatch = path.match(/^\/api\/goals\/([^/]+)\/resume$/);
  if (resumeMatch && method === "POST") {
    try {
      await engine.resumeGoal(resumeMatch[1]);
      json(res, { status: "resumed" });
    } catch (err: any) {
      json(res, { error: err.message }, 400);
    }
    return;
  }

  // POST /api/goals/:id/steer — Send a steering message to redirect a running goal
  const steerMatch = path.match(/^\/api\/goals\/([^/]+)\/steer$/);
  if (steerMatch && method === "POST") {
    const body = await parseBody(req);
    if (!body.message) {
      json(res, { error: "message is required" }, 400);
      return;
    }
    engine.sendSteeringMessage(steerMatch[1], body.message);
    json(res, { status: "steering message sent" });
    return;
  }

  // ── Goal Dependencies ───────────────────────────────

  // GET /api/goals/:id/dependencies
  const depsMatch = path.match(/^\/api\/goals\/([^/]+)\/dependencies$/);
  if (depsMatch && method === "GET") {
    if (!db) {
      json(res, []);
      return;
    }
    const deps = await db.getGoalDependencies(depsMatch[1]);
    json(res, deps);
    return;
  }

  // POST /api/goals/:id/dependencies — Add a dependency
  if (depsMatch && method === "POST") {
    if (!db) {
      json(res, { error: "No database configured" }, 400);
      return;
    }
    const body = await parseBody(req);
    if (!body.targetGoalId || !body.type) {
      json(res, { error: "targetGoalId and type are required" }, 400);
      return;
    }
    if (!["blocks", "enables"].includes(body.type)) {
      json(res, { error: "type must be 'blocks' or 'enables'" }, 400);
      return;
    }
    await db.addGoalDependency(depsMatch[1], body.targetGoalId, body.type);
    json(res, { status: "dependency added" }, 201);
    return;
  }

  // ── Observability Routes ──────────────────────────

  // GET /api/costs/today
  if (path === "/api/costs/today" && method === "GET") {
    if (!db) {
      const totalCost = engine.getGoals().reduce((sum, g) => sum + g.costUsd, 0);
      json(res, { total: totalCost });
      return;
    }
    const total = await db.getTotalSpendToday();
    json(res, { total });
    return;
  }

  // GET /api/costs/hourly
  if (path === "/api/costs/hourly" && method === "GET") {
    if (!db) {
      json(res, []);
      return;
    }
    const hours = parseInt(parsed.query.hours as string) || 24;
    const data = await db.getHourlySpend(hours);
    json(res, data);
    return;
  }

  // GET /api/tools/breakdown
  if (path === "/api/tools/breakdown" && method === "GET") {
    if (!db) {
      json(res, []);
      return;
    }
    const hours = parseInt(parsed.query.hours as string) || 24;
    const data = await db.getToolBreakdown(hours);
    json(res, data);
    return;
  }

  // GET /api/analytics/outcomes
  if (path === "/api/analytics/outcomes" && method === "GET") {
    if (!db) {
      json(res, []);
      return;
    }
    const days = parseInt(parsed.query.days as string) || 7;
    const data = await db.getGoalOutcomeDistribution(days);
    json(res, data);
    return;
  }

  // GET /api/analytics/completions
  if (path === "/api/analytics/completions" && method === "GET") {
    if (!db) {
      json(res, []);
      return;
    }
    const days = parseInt(parsed.query.days as string) || 30;
    const data = await db.getDailyCompletionTrend(days);
    json(res, data);
    return;
  }

  // GET /api/activity
  if (path === "/api/activity" && method === "GET") {
    if (!db) {
      json(res, []);
      return;
    }
    const limit = parseInt(parsed.query.limit as string) || 50;
    const data = await db.getRecentActivity(limit);
    json(res, data);
    return;
  }

  // ── Metrics Aggregation ─────────────────────────────

  // GET /api/metrics/hourly — pre-aggregated hourly metrics
  if (path === "/api/metrics/hourly" && method === "GET") {
    if (!db) {
      json(res, []);
      return;
    }
    const hours = parseInt(parsed.query.hours as string) || 24;
    const data = await db.getHourlyMetrics(hours);
    json(res, data);
    return;
  }

  // POST /api/metrics/aggregate — trigger aggregation manually
  if (path === "/api/metrics/aggregate" && method === "POST") {
    if (!db) {
      json(res, { error: "No database configured" }, 400);
      return;
    }
    const body = await parseBody(req);
    const hours = body.hours || 2;
    const count = await db.aggregateHourlyMetrics(hours);
    json(res, { status: "aggregated", rows_affected: count });
    return;
  }

  // ── Settings ──────────────────────────────────────

  // PUT /api/settings
  if (path === "/api/settings" && method === "PUT") {
    const body = await parseBody(req);
    engine.updateSettings(body);
    json(res, { status: "updated" });
    return;
  }

  // ── Webhooks ───────────────────────────────────────

  // POST /api/webhooks — Register a webhook extension
  if (path === "/api/webhooks" && method === "POST") {
    const body = await parseBody(req) as WebhookConfig;
    if (!body.url) {
      json(res, { error: "url is required" }, 400);
      return;
    }
    try {
      const ext = createWebhookExtension(body);
      engine.registerExtension(ext);
      json(res, { status: "webhook registered", name: ext.name }, 201);
    } catch (err: any) {
      json(res, { error: err.message }, 400);
    }
    return;
  }

  // GET /api/webhooks — List registered webhook extensions
  if (path === "/api/webhooks" && method === "GET") {
    const webhooks = engine.getExtensions().filter(n => n.startsWith("webhook-"));
    json(res, { webhooks });
    return;
  }

  // ── Export ─────────────────────────────────────────

  // GET /api/export/goals — Export all goals as JSON
  if (path === "/api/export/goals" && method === "GET") {
    const format = parsed.query.format as string || "json";
    const goals = db ? await db.listGoals({ limit: 1000 }) : engine.getGoals();
    if (format === "csv") {
      const header = "id,title,status,outcome,progress,cost_usd,input_tokens,output_tokens,turn_count,started_at,completed_at";
      const rows = goals.map((g: any) => {
        const id = g.id;
        const title = `"${(g.title || "").replace(/"/g, '""')}"`;
        const status = g.status;
        const outcome = g.outcome || "";
        const progress = g.progress ?? 0;
        const cost = g.cost_usd ?? g.costUsd ?? 0;
        const inputTokens = g.input_tokens ?? g.inputTokens ?? 0;
        const outputTokens = g.output_tokens ?? g.outputTokens ?? 0;
        const turns = g.turn_count ?? g.turnCount ?? 0;
        const started = g.started_at ?? new Date(g.startedAt).toISOString();
        const completed = g.completed_at ?? (g.completedAt ? new Date(g.completedAt).toISOString() : "");
        return `${id},${title},${status},${outcome},${progress},${cost},${inputTokens},${outputTokens},${turns},${started},${completed}`;
      });
      res.writeHead(200, {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="fabric-goals-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Access-Control-Allow-Origin": "*",
      });
      res.end([header, ...rows].join("\n"));
    } else {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="fabric-goals-${new Date().toISOString().slice(0, 10)}.json"`,
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(goals, null, 2));
    }
    return;
  }

  // GET /api/export/costs — Export cost events as CSV/JSON
  if (path === "/api/export/costs" && method === "GET") {
    if (!db) {
      json(res, { error: "No database configured for cost export" }, 400);
      return;
    }
    const hours = parseInt(parsed.query.hours as string) || 24;
    const data = await db.getHourlySpend(hours);
    const format = parsed.query.format as string || "json";
    if (format === "csv") {
      const header = "hour,spend,input_tokens,output_tokens";
      const rows = data.map((r: any) => `${r.hour},${r.spend},${r.input_tokens},${r.output_tokens}`);
      res.writeHead(200, {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="fabric-costs-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Access-Control-Allow-Origin": "*",
      });
      res.end([header, ...rows].join("\n"));
    } else {
      json(res, data);
    }
    return;
  }

  notFound(res);
}

// ── Server Start ──────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err: any) {
    serverMetrics.errorCount++;
    console.error("Request error:", err);
    json(res, { error: err.message || "Internal server error" }, 500);
  }
});

async function start(): Promise<void> {
  // Run migrations if database is configured
  if (db) {
    console.log("Running database migrations...");
    await db.migrate();
    console.log("Migrations complete.");
  }

  // Start periodic metrics aggregation (every 5 minutes)
  if (db) {
    const AGGREGATION_INTERVAL = 5 * 60_000;
    const runAggregation = async () => {
      try {
        const count = await db.aggregateHourlyMetrics(2);
        if (count > 0) console.log(`Metrics aggregation: ${count} hourly buckets updated`);
      } catch (err) {
        console.error("Metrics aggregation error:", err);
      }
    };
    // Run once at startup after a brief delay, then periodically
    setTimeout(runAggregation, 5000);
    setInterval(runAggregation, AGGREGATION_INTERVAL);
  }

  server.listen(PORT, () => {
    console.log(`Fabric API server listening on port ${PORT}`);
    console.log(`  Health: http://localhost:${PORT}/health`);
    console.log(`  Events: http://localhost:${PORT}/events (SSE)`);
    console.log(`  Goals:  http://localhost:${PORT}/api/goals`);
    console.log(`  Stats:  http://localhost:${PORT}/api/server/stats`);
    if (db) {
      console.log(`  DB:     connected (metrics aggregation every 5m)`);
    } else {
      console.log(`  DB:     none (in-memory only)`);
    }
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

// Graceful shutdown with connection draining
async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received. Draining connections...`);

  // Close SSE clients gracefully
  for (const client of wsClients) {
    try {
      client.write(`data: ${JSON.stringify({ type: "server-shutdown", data: { reason: signal } })}\n\n`);
      client.end();
    } catch { /* ignore */ }
  }
  wsClients.clear();

  // Stop accepting new connections
  server.close(() => {
    console.log("HTTP server closed.");
  });

  // Final metrics aggregation before shutdown
  if (db) {
    try {
      await db.aggregateHourlyMetrics(1);
      console.log("Final metrics aggregation complete.");
    } catch (err) {
      console.error("Final aggregation error:", err);
    }
    await db.close();
    console.log("Database connection closed.");
  }

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
