# Observability

## Overview

Fabric provides deep observability into AI agent execution. Every tool call, token usage event, and goal lifecycle change is instrumented and available in real-time and historically.

## Instrumentation Points

### Turn Counting

Every assistant message from the Claude Agent SDK increments the goal's `turnCount`. This tracks how many LLM inference rounds were needed to complete a goal.

```
Assistant message → goal.turnCount++
```

Turns are the primary unit of "work" for cost estimation and budget enforcement.

### Tool Call Timing

Every tool invocation is timed using PreToolUse/PostToolUse hooks in `FabricEngine`:

```
PreToolUse hook:
  → Record start time in pendingToolCalls Map
  → Key: "{goalId}:{toolName}:{timestamp}"

PostToolUse hook:
  → Look up pending call by key
  → Calculate duration = now - startedAt
  → Record success/failure
  → Emit "tool-call" event
  → Append ToolCallRecord to goal.toolCalls[]
```

Each `ToolCallRecord` contains:
- `tool` — Tool name (e.g., "Read", "Bash", "Grep")
- `startedAt` — Unix timestamp (ms)
- `durationMs` — Wall-clock duration
- `success` — Whether the tool call succeeded
- `goalId` — Parent goal

### Cost Tracking

Token usage is extracted from each assistant message's `usage` field:

```
usage.input_tokens  → goal.inputTokens (cumulative)
usage.output_tokens → goal.outputTokens (cumulative)

cost = (inputTokens / 1M) * inputPrice + (outputTokens / 1M) * outputPrice
```

**Pricing by model:**

| Model | Input (per 1M) | Output (per 1M) |
|-------|----------------|-----------------|
| Sonnet 4.6 | $3.00 | $15.00 |
| Opus 4.6 | $15.00 | $75.00 |
| Haiku 4.5 | $0.80 | $4.00 |

Cost events are emitted on every turn and persisted as time-series data in the `cost_events` table.

### Goal Outcomes

When a goal finishes (SDK result message), an outcome is recorded:

| Outcome | Trigger |
|---------|---------|
| `success` | Agent completed normally |
| `budget_exhausted` | Hit `maxBudgetUsd` limit |
| `turns_exhausted` | Hit `maxTurns` limit |
| `user_abort` | User paused/cancelled |
| `error` | Unhandled exception |

## Events

All observability data flows through the `FabricEvent` system:

### `tool-call` Event
Emitted after every tool invocation completes.
```json
{
  "type": "tool-call",
  "goalId": "goal-1-...",
  "data": {
    "tool": "Read",
    "startedAt": 1709726400000,
    "durationMs": 15,
    "success": true,
    "goalId": "goal-1-..."
  }
}
```

### `cost-update` Event
Emitted after every LLM turn with cumulative totals.
```json
{
  "type": "cost-update",
  "goalId": "goal-1-...",
  "data": {
    "costUsd": 0.142,
    "inputTokens": 28400,
    "outputTokens": 5200
  }
}
```

### `observability` Event
Emitted once when a goal finishes, providing a complete summary.
```json
{
  "type": "observability",
  "goalId": "goal-1-...",
  "data": {
    "outcome": "success",
    "turnCount": 12,
    "toolCallCount": 34,
    "totalCost": 0.287,
    "durationMs": 45200,
    "toolBreakdown": {
      "Read": { "count": 15, "totalMs": 180, "errors": 0 },
      "Grep": { "count": 8, "totalMs": 95, "errors": 0 },
      "Edit": { "count": 6, "totalMs": 240, "errors": 1 },
      "Bash": { "count": 5, "totalMs": 12400, "errors": 0 }
    }
  }
}
```

## Database Storage

### Real-time (in-memory)

- `FabricGoal.toolCalls[]` — Array of all tool call records
- `FabricGoal.turnCount` — Total turns
- `FabricGoal.costUsd` / `inputTokens` / `outputTokens` — Cumulative cost

### Persistent (PostgreSQL)

| Table | Data | Retention |
|-------|------|-----------|
| `goals` | Lifecycle, outcome, final cost | Indefinite |
| `tool_calls` | Every tool invocation with timing | 30 days |
| `cost_events` | Per-turn cost data (time-series) | 90 days |
| `activity_log` | All events chronologically | 30 days |
| `hourly_metrics` | Pre-aggregated dashboard data | Indefinite |

See [data-model.md](data-model.md) for the full schema.

## Dashboard Queries

### Spend rate (real-time)

The costs view uses hourly aggregation to show burn rate:

```sql
SELECT date_trunc('hour', timestamp) as hour,
       SUM(cost_usd) as spend
FROM cost_events
WHERE timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY 1 ORDER BY 1;
```

### Tool performance

Identify slow or failing tools:

```sql
SELECT tool,
       COUNT(*) as calls,
       AVG(duration_ms) as avg_ms,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_ms,
       COUNT(*) FILTER (WHERE NOT success) as errors
FROM tool_calls
WHERE started_at >= NOW() - INTERVAL '1 hour'
GROUP BY tool ORDER BY calls DESC;
```

### Cost efficiency

Compare cost per successful goal over time:

```sql
SELECT date_trunc('day', completed_at) as day,
       AVG(cost_usd) FILTER (WHERE outcome = 'success') as avg_success_cost,
       AVG(turn_count) FILTER (WHERE outcome = 'success') as avg_success_turns
FROM goals
WHERE completed_at >= NOW() - INTERVAL '30 days'
GROUP BY 1 ORDER BY 1;
```

## Metrics Aggregation

The `hourly_metrics` table stores pre-computed metrics for dashboard performance. Metrics are aggregated by a periodic job (or can be computed on-demand):

- `total_cost` — Total USD spent in the hour
- `goal_count` — Goals created
- `completion_rate` — % of goals that completed successfully
- `avg_turn_count` — Average turns per goal
- `tool_error_rate` — % of tool calls that failed

## Alerting (Planned)

Future alerting rules based on observability data:

- **Budget alert**: Daily spend exceeds threshold
- **Error spike**: Tool error rate exceeds 10% in any hour
- **Stale goal**: Active goal with no progress for > 30 minutes
- **Turn runaway**: Goal approaching turn limit with low progress
