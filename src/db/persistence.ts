/**
 * Fabric Persistence Layer
 *
 * PostgreSQL-backed storage for goals, tool calls, cost events, and activity.
 * Wraps the `pg` module and provides typed query methods used by FabricEngine
 * and the HTTP API server.
 */

import { Pool, PoolConfig } from "pg";
import type { FabricGoal, FabricStep, ToolCallRecord } from "../fabric";

// ── Types ─────────────────────────────────────────────

export interface GoalRow {
  id: string;
  title: string;
  summary: string;
  status: string;
  progress: number;
  agent_count: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  turn_count: number;
  outcome: string | null;
  session_id: string | null;
  started_at: Date;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CostEventRow {
  id: number;
  goal_id: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  model: string | null;
  timestamp: Date;
}

export interface ToolCallRow {
  id: number;
  goal_id: string;
  tool: string;
  started_at: Date;
  duration_ms: number;
  success: boolean;
  error: string | null;
  metadata: any;
}

export interface HourlySpend {
  hour: Date;
  spend: number;
  input_tokens: number;
  output_tokens: number;
}

export interface ToolBreakdownRow {
  tool: string;
  call_count: number;
  avg_duration_ms: number;
  error_count: number;
  total_ms: number;
}

// ── Persistence Class ─────────────────────────────────

export class FabricDB {
  private pool: Pool;

  constructor(connectionString?: string) {
    const config: PoolConfig = connectionString
      ? { connectionString, max: 20, idleTimeoutMillis: 30000 }
      : {
          host: process.env.PGHOST || "localhost",
          port: parseInt(process.env.PGPORT || "5432"),
          database: process.env.PGDATABASE || "fabric",
          user: process.env.PGUSER,
          password: process.env.PGPASSWORD,
          max: 20,
          idleTimeoutMillis: 30000,
        };
    this.pool = new Pool(config);
  }

  /** Run all migrations in order (idempotent). */
  async migrate(): Promise<void> {
    const fs = await import("fs");
    const path = await import("path");
    const migrationsDir = path.join(__dirname, "migrations");
    const files = fs.readdirSync(migrationsDir).filter((f: string) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      await this.pool.query(sql);
    }
  }

  /** Graceful shutdown. */
  async close(): Promise<void> {
    await this.pool.end();
  }

  // ── Goals ───────────────────────────────────────────

  async upsertGoal(goal: FabricGoal): Promise<void> {
    await this.pool.query(
      `INSERT INTO goals (id, title, summary, status, progress, agent_count, cost_usd,
                          input_tokens, output_tokens, turn_count, outcome, session_id,
                          started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               to_timestamp($13::double precision / 1000),
               CASE WHEN $14::double precision IS NOT NULL
                    THEN to_timestamp($14::double precision / 1000) ELSE NULL END)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         summary = EXCLUDED.summary,
         status = EXCLUDED.status,
         progress = EXCLUDED.progress,
         agent_count = EXCLUDED.agent_count,
         cost_usd = EXCLUDED.cost_usd,
         input_tokens = EXCLUDED.input_tokens,
         output_tokens = EXCLUDED.output_tokens,
         turn_count = EXCLUDED.turn_count,
         outcome = EXCLUDED.outcome,
         session_id = EXCLUDED.session_id,
         completed_at = EXCLUDED.completed_at`,
      [goal.id, goal.title, goal.summary, goal.status, goal.progress,
       goal.agentCount, goal.costUsd, goal.inputTokens, goal.outputTokens,
       goal.turnCount, goal.outcome || null, goal.sessionId || null,
       goal.startedAt, goal.completedAt || null]
    );
  }

  async getGoal(id: string): Promise<GoalRow | null> {
    const { rows } = await this.pool.query("SELECT * FROM goals WHERE id = $1", [id]);
    return rows[0] || null;
  }

  async listGoals(opts?: { status?: string; limit?: number; offset?: number }): Promise<GoalRow[]> {
    let sql = "SELECT * FROM goals";
    const params: any[] = [];
    if (opts?.status) {
      params.push(opts.status);
      sql += ` WHERE status = $${params.length}`;
    }
    sql += " ORDER BY started_at DESC";
    if (opts?.limit) {
      params.push(opts.limit);
      sql += ` LIMIT $${params.length}`;
    }
    if (opts?.offset) {
      params.push(opts.offset);
      sql += ` OFFSET $${params.length}`;
    }
    const { rows } = await this.pool.query(sql, params);
    return rows;
  }

  // ── Steps ───────────────────────────────────────────

  async upsertSteps(goalId: string, steps: FabricStep[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM steps WHERE goal_id = $1", [goalId]);
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        await client.query(
          `INSERT INTO steps (goal_id, index, name, state, agent, detail)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [goalId, i, s.name, s.state, s.agent || null, s.detail || null]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getSteps(goalId: string): Promise<any[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM steps WHERE goal_id = $1 ORDER BY index", [goalId]
    );
    return rows;
  }

  // ── Tool Calls ──────────────────────────────────────

  async insertToolCall(record: ToolCallRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO tool_calls (goal_id, tool, started_at, duration_ms, success)
       VALUES ($1, $2, to_timestamp($3::double precision / 1000), $4, $5)`,
      [record.goalId, record.tool, record.startedAt, record.durationMs, record.success]
    );
  }

  async getToolBreakdown(hours?: number): Promise<ToolBreakdownRow[]> {
    const interval = hours || 24;
    const { rows } = await this.pool.query(
      `SELECT tool,
              COUNT(*)::int as call_count,
              ROUND(AVG(duration_ms))::int as avg_duration_ms,
              COUNT(*) FILTER (WHERE NOT success)::int as error_count,
              SUM(duration_ms)::int as total_ms
       FROM tool_calls
       WHERE started_at >= NOW() - make_interval(hours => $1)
       GROUP BY tool
       ORDER BY call_count DESC`,
      [interval]
    );
    return rows;
  }

  // ── Cost Events ─────────────────────────────────────

  async insertCostEvent(goalId: string, costUsd: number, inputTokens: number, outputTokens: number, model?: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO cost_events (goal_id, cost_usd, input_tokens, output_tokens, model)
       VALUES ($1, $2, $3, $4, $5)`,
      [goalId, costUsd, inputTokens, outputTokens, model || null]
    );
  }

  async getTotalSpendToday(): Promise<number> {
    const { rows } = await this.pool.query(
      "SELECT COALESCE(SUM(cost_usd), 0)::real as total FROM cost_events WHERE timestamp >= CURRENT_DATE"
    );
    return rows[0].total;
  }

  async getHourlySpend(hours?: number): Promise<HourlySpend[]> {
    const interval = hours || 24;
    const { rows } = await this.pool.query(
      `SELECT date_trunc('hour', timestamp) as hour,
              SUM(cost_usd)::real as spend,
              SUM(input_tokens)::int as input_tokens,
              SUM(output_tokens)::int as output_tokens
       FROM cost_events
       WHERE timestamp >= NOW() - make_interval(hours => $1)
       GROUP BY 1
       ORDER BY 1`,
      [interval]
    );
    return rows;
  }

  // ── Activity Log ────────────────────────────────────

  async insertActivity(goalId: string | null, eventType: string, text: string, actor?: string, metadata?: any): Promise<void> {
    await this.pool.query(
      `INSERT INTO activity_log (goal_id, event_type, text, actor, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [goalId, eventType, text, actor || null, metadata ? JSON.stringify(metadata) : null]
    );
  }

  async getRecentActivity(limit?: number): Promise<any[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT $1",
      [limit || 50]
    );
    return rows;
  }

  // ── Metrics Aggregation ─────────────────────────────

  /**
   * Aggregate cost_events into hourly_rollups, materializing pre-computed
   * rollups for fast dashboard queries. Idempotent — uses ON CONFLICT to
   * update existing buckets.
   */
  async aggregateHourlyMetrics(hoursBack = 2): Promise<number> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO hourly_rollups (hour, goal_count, total_cost, input_tokens, output_tokens, tool_calls, errors)
       SELECT
         date_trunc('hour', ce.timestamp) AS hour,
         COUNT(DISTINCT ce.goal_id)::int AS goal_count,
         ROUND(SUM(ce.cost_usd)::numeric, 6)::real AS total_cost,
         SUM(ce.input_tokens)::bigint AS input_tokens,
         SUM(ce.output_tokens)::bigint AS output_tokens,
         COALESCE(tc.tool_calls, 0)::int AS tool_calls,
         COALESCE(tc.errors, 0)::int AS errors
       FROM cost_events ce
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS tool_calls,
           COUNT(*) FILTER (WHERE NOT success)::int AS errors
         FROM tool_calls
         WHERE date_trunc('hour', started_at) = date_trunc('hour', ce.timestamp)
       ) tc ON true
       WHERE ce.timestamp >= NOW() - make_interval(hours => $1)
       GROUP BY date_trunc('hour', ce.timestamp), tc.tool_calls, tc.errors
       ON CONFLICT (hour) DO UPDATE SET
         goal_count = EXCLUDED.goal_count,
         total_cost = EXCLUDED.total_cost,
         input_tokens = EXCLUDED.input_tokens,
         output_tokens = EXCLUDED.output_tokens,
         tool_calls = EXCLUDED.tool_calls,
         errors = EXCLUDED.errors`,
      [hoursBack]
    );
    return rowCount ?? 0;
  }

  /** Read pre-aggregated hourly metrics for the dashboard. */
  async getHourlyMetrics(hours = 24): Promise<any[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM hourly_rollups
       WHERE hour >= NOW() - make_interval(hours => $1)
       ORDER BY hour`,
      [hours]
    );
    return rows;
  }

  // ── Analytics ───────────────────────────────────────

  async getGoalOutcomeDistribution(days?: number): Promise<any[]> {
    const interval = days || 7;
    const { rows } = await this.pool.query(
      `SELECT outcome,
              COUNT(*)::int as count,
              ROUND(AVG(cost_usd)::numeric, 4)::real as avg_cost,
              ROUND(AVG(turn_count)::numeric, 1)::real as avg_turns
       FROM goals
       WHERE outcome IS NOT NULL
         AND started_at >= NOW() - make_interval(days => $1)
       GROUP BY outcome`,
      [interval]
    );
    return rows;
  }

  async getDailyCompletionTrend(days?: number): Promise<any[]> {
    const interval = days || 30;
    const { rows } = await this.pool.query(
      `SELECT date_trunc('day', completed_at) as day,
              COUNT(*)::int as goals_completed,
              ROUND(AVG(cost_usd)::numeric, 4)::real as avg_cost,
              ROUND(SUM(cost_usd)::numeric, 4)::real as total_cost
       FROM goals
       WHERE status = 'complete'
         AND completed_at >= NOW() - make_interval(days => $1)
       GROUP BY 1
       ORDER BY 1`,
      [interval]
    );
    return rows;
  }
}
