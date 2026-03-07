# Fabric Architecture

## Overview

Fabric is a control plane for autonomous AI agents. It orchestrates Claude-powered agents via the Claude Agent SDK, provides real-time observability, and gives humans a supervisory interface.

**Core thesis**: Agents are the primary workers. Humans are supervisors. Fabric is the operating system for this relationship.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Kubernetes Cluster                           │
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐ │
│  │   Fabric API     │    │   PostgreSQL      │    │   Redis       │ │
│  │   (server.ts)    │◄──►│   (persistence)   │    │   (optional)  │ │
│  │                  │    │                   │    │               │ │
│  │  - REST API      │    │  - Goals          │    │  - Caching    │ │
│  │  - WebSocket     │    │  - Tool calls     │    │  - Pub/Sub    │ │
│  │  - FabricEngine  │    │  - Cost events    │    │               │ │
│  └────────┬─────────┘    └───────────────────┘    └───────────────┘ │
│           │                                                         │
│           │ Anthropic API                                           │
│           ▼                                                         │
│  ┌──────────────────┐                                              │
│  │  Claude Agent SDK │                                              │
│  │  (claude.ai)      │                                              │
│  └──────────────────┘                                              │
└─────────────────────────────────────────────────────────────────────┘
          ▲
          │ HTTPS / WebSocket
          ▼
┌──────────────────┐
│  Electron Client  │
│  (renderer)       │
│                   │
│  - 14 modules     │
│  - Real-time UI   │
│  - Command bar    │
│  - Cost dashboard │
└──────────────────┘
```

## Component Breakdown

### 1. FabricEngine (`src/fabric.ts`)

The orchestration core. Wraps Claude Agent SDK to:

- **Goal management**: Create, execute, pause, complete goals
- **Agent execution**: Streams SDK messages, tracks progress via custom MCP tools
- **Observability**: Turn counting, tool call timing, cost tracking, outcome recording
- **Tool system**: Three MCP tools bridge agent execution to the work graph:
  - `report_steps` — Agent reports its planned steps
  - `update_step` — Agent marks steps running/done
  - `complete_goal` — Agent marks the goal complete

### 2. Persistence Layer (`src/db/`)

PostgreSQL-backed storage for all operational data:

- **Goals table**: Full lifecycle with status, progress, costs, outcomes
- **Tool calls table**: Every tool invocation with timing data
- **Cost events table**: Time-series cost data for charts and projections
- **Activity log table**: Chronological event stream

See [data-model.md](data-model.md) for the full schema.

### 3. Backend API (`src/server.ts`)

HTTP + WebSocket server that:

- Exposes REST endpoints for goal CRUD and observability queries
- Streams real-time events to connected clients via WebSocket
- Runs FabricEngine in server mode (no Electron dependency)
- Serves as the deployment target for Kubernetes

### 4. Electron Client (`src/renderer/`)

14 focused TypeScript modules bundled by esbuild:

| Module | Lines | Responsibility |
|--------|-------|---------------|
| `renderer.ts` | 221 | Entry point, init, view switching |
| `types.ts` | 101 | All shared types |
| `state.ts` | 88 | Central state + callbacks pattern |
| `utils.ts` | 28 | Formatters |
| `mock-data.ts` | 411 | Demo data + simulation |
| `toasts.ts` | 25 | Toast notifications |
| `detail-panels.ts` | 309 | Goal/agent slide-over panels |
| `cmdk.ts` | 148 | Command palette (Cmd+K) |
| `views.ts` | 135 | Simple views |
| `view-agents.ts` | 49 | Agent grid |
| `view-graph.ts` | 159 | DAG visualization |
| `view-costs.ts` | 302 | Finance dashboard |
| `view-settings.ts` | 191 | Settings panel |
| `event-handler.ts` | 76 | Event dispatcher |

### 5. Helm Charts (`helm/fabric/`)

Kubernetes deployment with:

- Fabric API deployment (configurable replicas)
- PostgreSQL StatefulSet with persistent volume
- ConfigMap for non-sensitive config
- Secret for API keys and DB credentials
- Ingress for external access
- Resource limits and health checks

## Data Flow

### Goal Execution Flow
```
User creates goal (Cmd+K → "create: fix login bug")
  → renderer.ts/createGoalFromNL()
    → IPC bridge → main.ts
      → FabricEngine.createGoal()
        → FabricEngine.executeGoal()
          → Claude Agent SDK query()
            → Agent calls report_steps MCP tool
            → Agent calls update_step for each step
            → Agent delegates to subagents (researcher, implementer, reviewer)
            → Agent calls complete_goal
          → Each SDK message → handleSDKMessage()
            → Track tokens, costs, turns
          → Each tool call → PreToolUse/PostToolUse hooks
            → Track tool duration, success/failure
        → FabricEvent emitted for each state change
          → IPC → renderer event-handler.ts
            → UI updates reactively
```

### Observability Data Flow
```
Every agent action generates events:
  tool-call → { tool, duration, success, goalId }
  cost-update → { costUsd, inputTokens, outputTokens }
  observability → { outcome, turnCount, toolCallCount, toolBreakdown }

Events flow to:
  1. In-memory state (renderer) → real-time UI updates
  2. PostgreSQL (persistence) → historical queries
  3. WebSocket (server mode) → connected clients
```

## Build System

```
npm run build
  ├── tsc -p tsconfig.main.json     → Compiles Node-side code (CommonJS)
  │   ├── main.ts → dist/main.js
  │   ├── preload.ts → dist/preload.js
  │   ├── fabric.ts → dist/fabric.js
  │   └── server.ts → dist/server.js
  │
  ├── node esbuild.renderer.mjs     → Bundles renderer (IIFE for browser)
  │   └── 14 renderer/*.ts → dist/renderer/renderer.js
  │
  └── cp index.html styles.css      → Static assets to dist/renderer/
```

## Design Decisions

1. **No React/Vue**: Vanilla TypeScript with template literals. Keeps the bundle small, avoids framework churn, and matches the "tool-like" aesthetic.

2. **esbuild over webpack**: 100x faster, zero config. Handles TypeScript natively. Only needed for the renderer bundle.

3. **Callbacks pattern over event bus**: Cross-module function calls use `state.callbacks` object set during init. Simpler than a pub/sub system, avoids circular imports.

4. **Mock data as first-class**: Demo mode works without an API key. Mock data lives in its own module and populates the same state objects that real data uses.

5. **PostgreSQL over SQLite**: Production-grade persistence that scales. SQLite would work for desktop-only, but the server deployment needs real concurrency.

6. **Helm charts from day one**: Infrastructure-as-code. Enables reproducible deployments and easy scaling.
