# Data Model

## Overview

Fabric uses PostgreSQL for persistent storage of all operational data. The schema is designed for:

- **Fast writes**: Append-only event tables for high-throughput logging
- **Analytical queries**: Indexed time-series data for cost charts and projections
- **Operational queries**: Goal status, agent performance, tool usage patterns

## Schema

### goals

The primary entity. Tracks the full lifecycle of an AI agent goal.

```sql
CREATE TABLE goals (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    summary         TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'complete', 'blocked', 'failed')),
    progress        REAL NOT NULL DEFAULT 0,
    agent_count     INTEGER NOT NULL DEFAULT 0,
    cost_usd        REAL NOT NULL DEFAULT 0,
    input_tokens    BIGINT NOT NULL DEFAULT 0,
    output_tokens   BIGINT NOT NULL DEFAULT 0,
    turn_count      INTEGER NOT NULL DEFAULT 0,
    outcome         TEXT CHECK (outcome IN ('success', 'budget_exhausted', 'turns_exhausted', 'user_abort', 'error')),
    session_id      TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_goals_status ON goals(status);
CREATE INDEX idx_goals_started ON goals(started_at);
CREATE INDEX idx_goals_outcome ON goals(outcome);
```

### steps

Decomposed work units within a goal.

```sql
CREATE TABLE steps (
    id          SERIAL PRIMARY KEY,
    goal_id     TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    index       INTEGER NOT NULL,
    name        TEXT NOT NULL,
    state       TEXT NOT NULL DEFAULT 'waiting'
                CHECK (state IN ('waiting', 'running', 'done', 'failed')),
    agent       TEXT,
    detail      TEXT,
    started_at  TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(goal_id, index)
);

CREATE INDEX idx_steps_goal ON steps(goal_id);
CREATE INDEX idx_steps_state ON steps(state);
```

### tool_calls

Every tool invocation with timing data. This is the core observability table.

```sql
CREATE TABLE tool_calls (
    id          SERIAL PRIMARY KEY,
    goal_id     TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    tool        TEXT NOT NULL,
    started_at  TIMESTAMPTZ NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    success     BOOLEAN NOT NULL DEFAULT true,
    error       TEXT,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tool_calls_goal ON tool_calls(goal_id);
CREATE INDEX idx_tool_calls_tool ON tool_calls(tool);
CREATE INDEX idx_tool_calls_time ON tool_calls(started_at);
CREATE INDEX idx_tool_calls_success ON tool_calls(success) WHERE NOT success;
```

### cost_events

Time-series cost data. One row per cost-bearing event (usually per LLM turn).

```sql
CREATE TABLE cost_events (
    id              SERIAL PRIMARY KEY,
    goal_id         TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    cost_usd        REAL NOT NULL,
    input_tokens    INTEGER NOT NULL DEFAULT 0,
    output_tokens   INTEGER NOT NULL DEFAULT 0,
    model           TEXT,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cost_events_goal ON cost_events(goal_id);
CREATE INDEX idx_cost_events_time ON cost_events(timestamp);

-- For hourly aggregation queries
CREATE INDEX idx_cost_events_hour ON cost_events(date_trunc('hour', timestamp));
```

### activity_log

Chronological stream of all agent actions, human decisions, and system events.

```sql
CREATE TABLE activity_log (
    id          SERIAL PRIMARY KEY,
    goal_id     TEXT REFERENCES goals(id) ON DELETE SET NULL,
    event_type  TEXT NOT NULL,
    text        TEXT NOT NULL,
    actor       TEXT,  -- 'system', 'user', or agent name
    metadata    JSONB,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_time ON activity_log(timestamp);
CREATE INDEX idx_activity_goal ON activity_log(goal_id);
CREATE INDEX idx_activity_type ON activity_log(event_type);
```

### goal_dependencies

Tracks blockedBy/enables relationships between goals.

```sql
CREATE TABLE goal_dependencies (
    id              SERIAL PRIMARY KEY,
    from_goal_id    TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    to_goal_id      TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    dep_type        TEXT NOT NULL CHECK (dep_type IN ('blocks', 'enables')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(from_goal_id, to_goal_id, dep_type)
);

CREATE INDEX idx_deps_from ON goal_dependencies(from_goal_id);
CREATE INDEX idx_deps_to ON goal_dependencies(to_goal_id);
```

### hourly_metrics

Pre-aggregated metrics for dashboard queries. Populated by a periodic aggregation job.

```sql
CREATE TABLE hourly_metrics (
    bucket_hour     TIMESTAMPTZ NOT NULL,
    metric_name     TEXT NOT NULL,
    value           REAL NOT NULL,
    dimensions      JSONB DEFAULT '{}',

    PRIMARY KEY (bucket_hour, metric_name, dimensions)
);

CREATE INDEX idx_metrics_name ON hourly_metrics(metric_name, bucket_hour);
```

## Common Queries

### Total spend today
```sql
SELECT COALESCE(SUM(cost_usd), 0) as total
FROM cost_events
WHERE timestamp >= CURRENT_DATE;
```

### Hourly spend for last 24 hours
```sql
SELECT date_trunc('hour', timestamp) as hour,
       SUM(cost_usd) as spend,
       SUM(input_tokens) as input_tokens,
       SUM(output_tokens) as output_tokens
FROM cost_events
WHERE timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY 1
ORDER BY 1;
```

### Tool usage breakdown
```sql
SELECT tool,
       COUNT(*) as call_count,
       AVG(duration_ms) as avg_duration_ms,
       COUNT(*) FILTER (WHERE NOT success) as error_count,
       SUM(duration_ms) as total_ms
FROM tool_calls
WHERE started_at >= NOW() - INTERVAL '24 hours'
GROUP BY tool
ORDER BY call_count DESC;
```

### Goal outcome distribution
```sql
SELECT outcome,
       COUNT(*) as count,
       AVG(cost_usd) as avg_cost,
       AVG(turn_count) as avg_turns
FROM goals
WHERE outcome IS NOT NULL
  AND started_at >= NOW() - INTERVAL '7 days'
GROUP BY outcome;
```

### Cost per completed goal (trending)
```sql
SELECT date_trunc('day', completed_at) as day,
       COUNT(*) as goals_completed,
       AVG(cost_usd) as avg_cost,
       SUM(cost_usd) as total_cost
FROM goals
WHERE status = 'complete'
  AND completed_at >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1;
```

## Retention Policy

| Table | Retention | Notes |
|-------|-----------|-------|
| `goals` | Indefinite | Core entity, small volume |
| `steps` | Indefinite | Tied to goals |
| `tool_calls` | 30 days | High volume, prune old rows |
| `cost_events` | 90 days | Aggregate into hourly_metrics before pruning |
| `activity_log` | 30 days | High volume |
| `hourly_metrics` | Indefinite | Pre-aggregated, small volume |
| `goal_dependencies` | Indefinite | Tied to goals |

## Migrations

Migrations are numbered SQL files in `src/db/migrations/`. Apply in order:

```bash
psql $DATABASE_URL < src/db/migrations/001_initial.sql
```

Each migration is idempotent (uses `IF NOT EXISTS`).
