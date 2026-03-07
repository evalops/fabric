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

// ── Configuration ─────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3000", 10);
const DATABASE_URL = process.env.DATABASE_URL;

// ── Init ──────────────────────────────────────────────

const engine = new FabricEngine();
const db = DATABASE_URL ? new FabricDB(DATABASE_URL) : null;

// Track connected WebSocket clients
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
    req.on("data", (chunk: string) => (body += chunk));
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

  // ── SSE Event Stream ─────────────────────────────
  if (path === "/events" && method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    wsClients.add(res);
    req.on("close", () => wsClients.delete(res));
    return;
  }

  // ── Health ────────────────────────────────────────
  if (path === "/health") {
    json(res, { status: "ok", goals: engine.getGoals().length, db: !!db });
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

  // POST /api/goals — Create a new goal
  if (path === "/api/goals" && method === "POST") {
    const body = await parseBody(req);
    if (!body.description) {
      json(res, { error: "description is required" }, 400);
      return;
    }
    const id = await engine.createGoal(body.description);
    json(res, { id, status: "created" }, 201);
    return;
  }

  // POST /api/goals/:id/pause — Pause a goal
  const pauseMatch = path.match(/^\/api\/goals\/([^/]+)\/pause$/);
  if (pauseMatch && method === "POST") {
    engine.pauseGoal(pauseMatch[1]);
    json(res, { status: "paused" });
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

  // ── Settings ──────────────────────────────────────

  // PUT /api/settings
  if (path === "/api/settings" && method === "PUT") {
    const body = await parseBody(req);
    engine.updateSettings(body);
    json(res, { status: "updated" });
    return;
  }

  notFound(res);
}

// ── Server Start ──────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err: any) {
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

  server.listen(PORT, () => {
    console.log(`Fabric API server listening on port ${PORT}`);
    console.log(`  Health: http://localhost:${PORT}/health`);
    console.log(`  Events: http://localhost:${PORT}/events (SSE)`);
    console.log(`  Goals:  http://localhost:${PORT}/api/goals`);
    if (db) {
      console.log(`  DB:     connected`);
    } else {
      console.log(`  DB:     none (in-memory only)`);
    }
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  server.close();
  if (db) await db.close();
  process.exit(0);
});
