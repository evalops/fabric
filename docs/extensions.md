# Extensions

## Overview

Fabric's extension system (inspired by [pi-mono](https://github.com/badlogic/pi-mono)) allows plugins to add custom tools, inject prompt context, and hook into the agent lifecycle. Extensions are registered on the `FabricEngine` instance before or during runtime.

## Extension Interface

```typescript
interface FabricExtension {
  name: string;

  /** Injected into the orchestrator's system prompt */
  promptSnippet?: string;

  /** Additional MCP tools registered alongside Fabric's built-in tools */
  tools?: ReturnType<typeof tool>[];

  /** Called before goal execution begins */
  beforeGoal?: (goalId: string, description: string) => Promise<void>;

  /** Called after goal execution completes */
  afterGoal?: (goalId: string, outcome: GoalOutcome | undefined) => Promise<void>;

  /** Called on every FabricEvent */
  onEvent?: (event: FabricEvent) => void;
}
```

## Registering Extensions

```typescript
import { FabricEngine } from "./fabric";

const engine = new FabricEngine();

engine.registerExtension({
  name: "slack-notifier",
  afterGoal: async (goalId, outcome) => {
    if (outcome === "success") {
      await postToSlack(`Goal ${goalId} completed successfully`);
    }
  },
  onEvent: (event) => {
    if (event.type === "attention") {
      postToSlack(`Attention needed: ${event.data.title}`);
    }
  },
});
```

## Extension Capabilities

### 1. Prompt Injection

Extensions can add instructions to the agent's system prompt:

```typescript
engine.registerExtension({
  name: "code-style",
  promptSnippet: `
    When writing code:
    - Use 2-space indentation
    - Prefer const over let
    - Add JSDoc comments to exported functions
  `,
});
```

The snippet is appended under an `--- Extension Context ---` heading in the orchestrator prompt. Multiple extensions' snippets are joined with newlines.

### 2. Custom Tools

Extensions can register additional MCP tools that the agent can call:

```typescript
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";

engine.registerExtension({
  name: "database",
  tools: [
    tool(
      "query_database",
      "Run a read-only SQL query against the application database",
      {
        sql: z.string().describe("The SQL query to execute"),
        database: z.enum(["production", "staging"]).describe("Which database"),
      },
      async (args) => {
        const result = await runQuery(args.database, args.sql);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
    ),
  ],
});
```

Extension tools are:
- Automatically registered on the Fabric MCP server
- Added to the agent's allowed tool list (prefixed with `mcp__fabric__`)
- Available alongside built-in tools (`report_steps`, `update_step`, `complete_goal`)

### 3. Lifecycle Hooks

#### `beforeGoal(goalId, description)`

Called before agent execution starts. Use cases:
- Set up resources (databases, temporary directories)
- Log to external systems
- Validate prerequisites

#### `afterGoal(goalId, outcome)`

Called after agent execution completes (including on error). Use cases:
- Clean up resources
- Send notifications
- Record metrics to external systems
- Trigger follow-up workflows

#### `onEvent(event)`

Called on every `FabricEvent`. Use cases:
- Stream events to external systems (Datadog, Grafana)
- Custom alerting logic
- Audit logging

**Note:** Extension errors in lifecycle hooks are caught and swallowed — they never crash the engine. If your extension needs error handling, implement it within the hook.

## Example: Metrics Extension

```typescript
engine.registerExtension({
  name: "datadog-metrics",
  onEvent: (event) => {
    switch (event.type) {
      case "cost-update":
        statsd.gauge("fabric.cost.total", event.data.costUsd, { goal: event.goalId });
        break;
      case "tool-call":
        statsd.histogram("fabric.tool.duration", event.data.durationMs, { tool: event.data.tool });
        if (!event.data.success) statsd.increment("fabric.tool.errors", { tool: event.data.tool });
        break;
      case "retry":
        statsd.increment("fabric.retries", { goal: event.goalId });
        break;
    }
  },
  afterGoal: async (goalId, outcome) => {
    statsd.increment("fabric.goals.completed", { outcome: outcome || "unknown" });
  },
});
```

## Example: Guardrails Extension

```typescript
engine.registerExtension({
  name: "guardrails",
  promptSnippet: `
    SAFETY RULES:
    - Never modify files in /etc or /usr
    - Never run rm -rf on directories above the working directory
    - Always create a backup before modifying configuration files
  `,
  beforeGoal: async (goalId, description) => {
    const blocked = ["delete production", "drop database", "format disk"];
    if (blocked.some(b => description.toLowerCase().includes(b))) {
      throw new Error(`Goal blocked by guardrails: "${description}"`);
    }
  },
});
```

## Listing Extensions

```typescript
const names = engine.getExtensions();
// ["slack-notifier", "datadog-metrics", "guardrails"]
```

## Design Principles

1. **Non-fatal**: Extension errors never crash the engine
2. **Composable**: Multiple extensions can coexist, each adding their own tools and prompts
3. **Observable**: Extensions receive all events via `onEvent`, enabling any monitoring integration
4. **Minimal surface**: The interface is intentionally small — five optional hooks cover most use cases
