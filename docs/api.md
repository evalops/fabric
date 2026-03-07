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

Create a new goal and begin agent execution.

**Request body:**
```json
{
  "description": "Fix the login bug in the auth module"
}
```

**Response:** `201 Created`
```json
{
  "id": "goal-2-1709...",
  "status": "created"
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
| 500 | Internal server error |
