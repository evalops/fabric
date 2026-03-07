# API Reference

## Overview

The Fabric API server (`src/server.ts`) provides a REST API and Server-Sent Events (SSE) stream for managing goals and querying observability data. It runs standalone without Electron, making it suitable for server/Kubernetes deployments.

## Base URL

```
http://localhost:3000
```

Configure via the `PORT` environment variable.

## Authentication

Not yet implemented. Planned: Bearer token via `Authorization` header.

## Endpoints

### Health

#### `GET /health`

Returns server status.

**Response:**
```json
{
  "status": "ok",
  "goals": 3,
  "db": true
}
```

---

### Event Stream

#### `GET /events`

Server-Sent Events stream of all real-time Fabric events. Connect with `EventSource` in the browser or `curl`.

**Response:** `text/event-stream`

Each event is a JSON-encoded `FabricEvent`:

```
data: {"type":"goal-created","goalId":"goal-1-1709...","data":{...}}

data: {"type":"cost-update","goalId":"goal-1-1709...","data":{"costUsd":0.12,"inputTokens":4200,"outputTokens":890}}
```

**Event types:**

| Type | Description |
|------|-------------|
| `goal-created` | New goal created |
| `goal-updated` | Goal status/progress changed |
| `step-updated` | Step within a goal changed state |
| `activity` | Chronological activity entry |
| `attention` | Item requiring human attention |
| `toast` | UI notification |
| `agent-message` | Agent text output |
| `cost-update` | Token usage and cost update |
| `tool-call` | Tool invocation completed |
| `observability` | Goal completion summary with metrics |

---

### Goals

#### `GET /api/goals`

List all goals, ordered by most recent first.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | string | — | Filter by status: `active`, `complete`, `blocked`, `failed` |
| `limit` | integer | 50 | Max results |
| `offset` | integer | 0 | Pagination offset |

**Response:**
```json
[
  {
    "id": "goal-1-1709...",
    "title": "Fix login bug",
    "status": "complete",
    "progress": 100,
    "cost_usd": 0.34,
    "turn_count": 12,
    "outcome": "success",
    "started_at": "2026-03-06T10:00:00Z",
    "completed_at": "2026-03-06T10:05:00Z"
  }
]
```

#### `GET /api/goals/:id`

Get a single goal with its steps.

**Response:**
```json
{
  "id": "goal-1-1709...",
  "title": "Fix login bug",
  "status": "complete",
  "steps": [
    { "index": 0, "name": "Analyze auth flow", "state": "done" },
    { "index": 1, "name": "Fix token refresh", "state": "done" }
  ]
}
```

#### `POST /api/goals`

Create a new goal and begin agent execution. Supports optional per-goal model override and budget/turns limits.

**Request body:**
```json
{
  "description": "Fix the login bug in the auth module",
  "model": "opus",
  "maxBudgetUsd": 5.00,
  "maxTurns": 50
}
```

Only `description` is required. `model` can be `"sonnet"`, `"opus"`, or `"haiku"`. If omitted, the engine default is used.

**Response:** `201 Created`
```json
{
  "id": "goal-2-1709...",
  "status": "created"
}
```

#### `POST /api/goals/batch`

Create multiple goals at once. All goals share the same batch ID for tracking. Maximum 20 goals per batch.

**Request body:**
```json
{
  "descriptions": [
    "Fix the login bug",
    "Add unit tests for auth module",
    "Update API documentation"
  ],
  "model": "sonnet",
  "maxBudgetUsd": 2.00
}
```

**Response:** `201 Created`
```json
{
  "batchId": "batch-1709...",
  "goalIds": ["goal-1-...", "goal-2-...", "goal-3-..."]
}
```

#### `POST /api/goals/:id/pause`

Pause a running goal by aborting agent execution.

**Response:**
```json
{
  "status": "paused"
}
```

#### `POST /api/goals/:id/resume`

Resume a previously paused, blocked, or failed goal. Re-starts agent execution with a continuation prompt that avoids repeating completed work.

**Response:**
```json
{
  "status": "resumed"
}
```

**Error (400):** Goal is already active or not found.

#### `GET /api/goals/:id/dependencies`

List goal dependencies (blocks/enables relationships).

**Response:**
```json
[
  {
    "from_goal_id": "goal-1-...",
    "to_goal_id": "goal-2-...",
    "dep_type": "blocks",
    "target_title": "Fix auth",
    "target_status": "active"
  }
]
```

#### `POST /api/goals/:id/dependencies`

Add a dependency relationship between goals.

**Request body:**
```json
{
  "targetGoalId": "goal-2-...",
  "type": "blocks"
}
```

**Response:** `201 Created`
```json
{
  "status": "dependency added"
}
```

---

### Server Stats

#### `GET /api/server/stats`

Server operational metrics for monitoring.

**Response:**
```json
{
  "uptime_seconds": 3600,
  "requests_total": 1420,
  "errors_total": 3,
  "sse_clients": 2,
  "active_goals": 3,
  "total_goals": 12,
  "rate_limit_max": 120,
  "db_connected": true
}
```

---

### Metrics Aggregation

#### `GET /api/metrics/hourly`

Pre-aggregated hourly metrics from the rollup table. Faster than computing from raw cost_events.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `hours` | integer | 24 | Lookback window in hours |

#### `POST /api/metrics/aggregate`

Manually trigger metrics aggregation into the `hourly_rollups` table.

**Request body:**
```json
{
  "hours": 2
}
```

**Response:**
```json
{
  "status": "aggregated",
  "rows_affected": 3
}
```

---

### Cost & Observability

#### `GET /api/costs/today`

Total spend for the current day.

**Response:**
```json
{
  "total": 2.47
}
```

#### `GET /api/costs/hourly`

Hourly cost breakdown.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `hours` | integer | 24 | Lookback window in hours |

**Response:**
```json
[
  {
    "hour": "2026-03-06T09:00:00Z",
    "spend": 0.52,
    "input_tokens": 18400,
    "output_tokens": 3200
  }
]
```

#### `GET /api/tools/breakdown`

Tool usage statistics.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `hours` | integer | 24 | Lookback window in hours |

**Response:**
```json
[
  {
    "tool": "Read",
    "call_count": 47,
    "avg_duration_ms": 12,
    "error_count": 0,
    "total_ms": 564
  }
]
```

#### `GET /api/analytics/outcomes`

Goal outcome distribution.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `days` | integer | 7 | Lookback window in days |

**Response:**
```json
[
  { "outcome": "success", "count": 14, "avg_cost": 0.28, "avg_turns": 8.3 },
  { "outcome": "budget_exhausted", "count": 2, "avg_cost": 2.00, "avg_turns": 28.5 }
]
```

#### `GET /api/analytics/completions`

Daily goal completion trend.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `days` | integer | 30 | Lookback window in days |

**Response:**
```json
[
  { "day": "2026-03-05", "goals_completed": 5, "avg_cost": 0.31, "total_cost": 1.55 }
]
```

---

### Activity

#### `GET /api/activity`

Recent activity log entries.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 50 | Max entries |

---

### Steering

#### `POST /api/goals/:id/steer`

Send a steering message to redirect a running goal's agent. The message is injected as additional context after the current tool call completes.

**Request body:**
```json
{
  "message": "Focus on the auth module first, skip the UI changes"
}
```

**Response:**
```json
{
  "status": "steering message sent"
}
```

**How it works:** Steering messages are queued and delivered via the PostToolUse hook's `additionalContext` field. After the agent's current tool finishes, it sees the human's message and can adjust its approach. This is inspired by pi-mono's dual-queue steering pattern.

---

### Settings

#### `PUT /api/settings`

Update engine configuration at runtime.

**Request body:**
```json
{
  "model": "claude-sonnet-4-6",
  "maxBudgetUsd": 5.00,
  "maxTurns": 50
}
```

**Response:**
```json
{
  "status": "updated"
}
```

---

### Webhooks

#### `POST /api/webhooks`

Register a webhook extension that posts events to an external URL.

**Request body:**
```json
{
  "url": "https://hooks.slack.com/services/...",
  "format": "slack",
  "events": ["observability", "attention", "retry"],
  "outcomes": ["success", "error"],
  "secret": "optional-hmac-secret",
  "headers": { "X-Custom": "value" }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | Webhook URL to POST to |
| `format` | No | `"slack"`, `"discord"`, or `"raw"` (default: `"raw"`) |
| `events` | No | Event types to send (default: all) |
| `outcomes` | No | Only send for these goal outcomes |
| `secret` | No | HMAC-SHA256 secret for `X-Fabric-Signature` header |
| `headers` | No | Custom headers to include |

**Response:** `201 Created`
```json
{
  "status": "webhook registered",
  "name": "webhook-hooks.slack.com"
}
```

#### `GET /api/webhooks`

List registered webhook extension names.

---

### Data Export

#### `GET /api/export/goals`

Export all goals as JSON or CSV.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `format` | string | `json` | `"json"` or `"csv"` |

Returns a downloadable file with `Content-Disposition` header.

#### `GET /api/export/costs`

Export hourly cost data as JSON or CSV.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `format` | string | `json` | `"json"` or `"csv"` |
| `hours` | integer | 24 | Lookback window |

---

## Error Responses

All errors follow this format:

```json
{
  "error": "description of what went wrong"
}
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request (missing/invalid parameters) |
| 404 | Resource not found |
| 429 | Rate limit exceeded (120 requests/minute per IP) |
| 500 | Internal server error |
