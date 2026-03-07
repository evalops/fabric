/**
 * Fabric Orchestration Engine
 *
 * Wraps the Claude Agent SDK to provide goal decomposition, agent execution,
 * and real-time streaming back to the UI.
 */

import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type {
  Options,
  SDKMessage,
  SDKAssistantMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import { EventEmitter } from "events";

// ── Types ─────────────────────────────────────────────

export interface FabricStep {
  name: string;
  state: "waiting" | "running" | "done" | "failed";
  agent?: string;
  detail?: string;
  time?: number;
}

export interface FabricGoal {
  id: string;
  title: string;
  summary: string;
  status: "active" | "complete" | "blocked" | "failed";
  progress: number;
  agentCount: number;
  steps: FabricStep[];
  timeline: { time: number; text: string }[];
  sessionId?: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  startedAt: number;
  completedAt?: number;
  // Observability
  turnCount: number;
  toolCalls: ToolCallRecord[];
  outcome?: GoalOutcome;
  // Retry tracking (inspired by pi-mono)
  retryCount: number;
  lastError?: string;
}

export type GoalOutcome = "success" | "budget_exhausted" | "turns_exhausted" | "user_abort" | "error";

export interface ToolCallRecord {
  tool: string;
  startedAt: number;
  durationMs: number;
  success: boolean;
  goalId: string;
}

export type FabricEventType =
  | "goal-created" | "goal-updated" | "step-updated"
  | "activity" | "attention" | "toast"
  | "agent-message" | "cost-update" | "tool-call"
  | "observability" | "steering" | "retry" | "compaction";

export interface FabricEvent {
  type: FabricEventType;
  goalId?: string;
  data: any;
}

export interface FabricAttention {
  id: string;
  kind: "warn" | "ask" | "crit";
  label: string;
  title: string;
  body: string;
  context: string;
  actions: { label: string; style: string }[];
  resolve?: (action: string) => void;
}

// ── Model Pricing (per 1M tokens) ────────────────────
// Inspired by pi-mono: cost tracking built into the model type

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  sonnet:  { input: 3.00,  output: 15.00 },
  opus:    { input: 15.00, output: 75.00 },
  haiku:   { input: 0.80,  output: 4.00  },
  inherit: { input: 3.00,  output: 15.00 },  // default to sonnet pricing
};

// ── Retry Configuration ──────────────────────────────
// Inspired by pi-mono: pattern-matched retryable errors with backoff

const RETRYABLE_PATTERNS = [
  /overloaded/i, /rate.?limit/i, /too many requests/i,
  /529/, /429/, /500/, /502/, /503/, /504/,
  /ECONNRESET/, /ECONNREFUSED/, /ETIMEDOUT/,
  /fetch failed/i, /network error/i,
];

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
};

function isRetryableError(err: Error): boolean {
  const msg = err.message || "";
  return RETRYABLE_PATTERNS.some(p => p.test(msg));
}

function retryDelay(attempt: number, config: RetryConfig): number {
  return Math.min(config.baseDelayMs * Math.pow(2, attempt), config.maxDelayMs);
}

// ── Custom MCP Tools for Fabric ───────────────────────
// These tools let the agent interact with Fabric's work graph

function createFabricTools(engine: FabricEngine, extensionTools: ReturnType<typeof tool>[] = []) {
  return createSdkMcpServer({
    name: "fabric",
    tools: [
      tool(
        "report_steps",
        "Report the decomposed steps for a goal. Call this after analyzing a goal to report back the planned execution steps.",
        {
          goalId: z.string().describe("The goal ID"),
          steps: z.array(z.object({
            name: z.string().describe("Short description of the step"),
            estimatedAgent: z.string().optional().describe("What kind of agent should handle this (e.g. 'code-reviewer', 'test-runner')"),
          })).describe("The steps to execute, in order"),
          summary: z.string().describe("A one-sentence summary of the plan"),
        },
        async (args) => {
          engine.handleStepsReported(args.goalId, args.steps, args.summary);
          return { content: [{ type: "text" as const, text: `Steps reported for goal ${args.goalId}. ${args.steps.length} steps planned.` }] };
        }
      ),
      tool(
        "update_step",
        "Update the status of a step in a goal.",
        {
          goalId: z.string(),
          stepIndex: z.number().describe("0-based index of the step"),
          state: z.enum(["waiting", "running", "done", "failed"]),
          detail: z.string().optional().describe("Progress detail or result"),
        },
        async (args) => {
          engine.handleStepUpdate(args.goalId, args.stepIndex, args.state, args.detail);
          return { content: [{ type: "text" as const, text: `Step ${args.stepIndex} updated to ${args.state}` }] };
        }
      ),
      tool(
        "complete_goal",
        "Mark a goal as complete with a final summary.",
        {
          goalId: z.string(),
          summary: z.string().describe("Final summary of what was accomplished"),
        },
        async (args) => {
          engine.handleGoalComplete(args.goalId, args.summary);
          return { content: [{ type: "text" as const, text: `Goal ${args.goalId} marked complete.` }] };
        }
      ),
      ...extensionTools,
    ],
  });
}

// ── Extension System (inspired by pi-mono) ───────────
// Extensions can register tools, inject prompt snippets, and hook into events

export interface FabricExtension {
  name: string;
  /** Additional instructions injected into the orchestrator's system prompt */
  promptSnippet?: string;
  /** Additional tools to register on the MCP server */
  tools?: ReturnType<typeof tool>[];
  /** Hook called before goal execution begins */
  beforeGoal?: (goalId: string, description: string) => Promise<void>;
  /** Hook called after goal execution completes */
  afterGoal?: (goalId: string, outcome: GoalOutcome | undefined) => Promise<void>;
  /** Hook called on every fabric event */
  onEvent?: (event: FabricEvent) => void;
}

// ── Fabric Engine ─────────────────────────────────────

export class FabricEngine extends EventEmitter {
  private goals: Map<string, FabricGoal> = new Map();
  private goalCounter = 0;
  private abortControllers: Map<string, AbortController> = new Map();
  private defaultBudget = 2.00;
  private defaultMaxTurns = 30;
  private defaultModel: "sonnet" | "opus" | "haiku" | "inherit" = "sonnet";
  private retryConfig: RetryConfig = DEFAULT_RETRY;
  // Track in-flight tool calls for duration measurement
  private pendingToolCalls: Map<string, { tool: string; startedAt: number; goalId: string }> = new Map();
  // Steering queue: messages injected mid-execution (inspired by pi-mono)
  private steeringQueues: Map<string, string[]> = new Map();
  // Extension system (inspired by pi-mono)
  private extensions: FabricExtension[] = [];

  constructor() {
    super();
  }

  /**
   * Register an extension.
   * Extensions can add tools, inject prompt context, and hook into lifecycle events.
   */
  registerExtension(ext: FabricExtension): void {
    this.extensions.push(ext);
    this.emitEvent({
      type: "activity",
      data: { time: Date.now(), text: `<strong>system</strong> extension "${ext.name}" registered` },
    });
  }

  /**
   * Get all registered extension names.
   */
  getExtensions(): string[] {
    return this.extensions.map(e => e.name);
  }

  getGoals(): FabricGoal[] {
    return Array.from(this.goals.values());
  }

  getGoal(id: string): FabricGoal | undefined {
    return this.goals.get(id);
  }

  /**
   * Create a new goal from natural language and start agent execution.
   */
  async createGoal(description: string): Promise<string> {
    const id = `goal-${++this.goalCounter}-${Date.now()}`;
    const title = description.charAt(0).toUpperCase() + description.slice(1);

    const goal: FabricGoal = {
      id,
      title,
      summary: "Analyzing and planning steps...",
      status: "active",
      progress: 0,
      agentCount: 0,
      steps: [],
      timeline: [
        { time: Date.now(), text: `Goal created by <strong>you</strong>: "${title}"` },
      ],
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      startedAt: Date.now(),
      turnCount: 0,
      toolCalls: [],
      retryCount: 0,
    };

    this.goals.set(id, goal);

    this.emitEvent({
      type: "goal-created",
      goalId: id,
      data: goal,
    });

    this.emitEvent({
      type: "toast",
      data: { title: "Goal created", body: `"${title}" — agents are picking it up`, color: "var(--accent)" },
    });

    // Start agent execution in the background
    this.executeGoal(id, description).catch(err => {
      console.error(`Goal ${id} execution failed:`, err);
      goal.status = "failed";
      goal.summary = `Failed: ${err.message}`;
      this.emitEvent({ type: "goal-updated", goalId: id, data: goal });
    });

    return id;
  }

  /**
   * Send a steering message to a running goal.
   * Inspired by pi-mono's dual-queue pattern: steering messages interrupt
   * the agent after the current tool call finishes, redirecting its focus.
   */
  sendSteeringMessage(goalId: string, message: string): void {
    let queue = this.steeringQueues.get(goalId);
    if (!queue) {
      queue = [];
      this.steeringQueues.set(goalId, queue);
    }
    queue.push(message);
    this.emitEvent({
      type: "steering",
      goalId,
      data: { message, time: Date.now() },
    });
    this.emitEvent({
      type: "activity",
      goalId,
      data: { time: Date.now(), text: `<strong>you</strong> sent steering message: "${message}"` },
    });
  }

  /**
   * Drain pending steering messages for a goal.
   * Called in the PostToolUse hook to check for human interruptions.
   */
  private drainSteeringMessages(goalId: string): string[] {
    const queue = this.steeringQueues.get(goalId);
    if (!queue || queue.length === 0) return [];
    const messages = [...queue];
    queue.length = 0;
    return messages;
  }

  /**
   * Execute a goal using the Claude Agent SDK.
   * Implements retry with exponential backoff (inspired by pi-mono):
   * - Pattern-matched retryable errors (429, 500, overloaded, etc.)
   * - Error scrubbing: transient errors are NOT shown to the LLM on retry
   * - Retry counter resets on any successful assistant response
   */
  private async executeGoal(goalId: string, description: string): Promise<void> {
    const goal = this.goals.get(goalId);
    if (!goal) return;

    const abortController = new AbortController();
    this.abortControllers.set(goalId, abortController);
    this.steeringQueues.set(goalId, []);

    // Collect extension tools and prompt snippets
    const extTools = this.extensions.flatMap(e => e.tools || []);
    const extPromptSnippets = this.extensions
      .filter(e => e.promptSnippet)
      .map(e => `[Extension: ${e.name}]\n${e.promptSnippet}`)
      .join("\n\n");

    // Notify extensions before execution
    for (const ext of this.extensions) {
      if (ext.beforeGoal) await ext.beforeGoal(goalId, description);
    }

    const fabricTools = createFabricTools(this, extTools);
    const extToolNames = extTools.map((t: any) => `mcp__fabric__${t.name || "unknown"}`);

    const buildOptions = (): Options => ({
      abortController,
      agents: {
        "researcher": {
          description: "Research agent for gathering information and analyzing code",
          prompt: "You are a research agent. Analyze code, search for information, and report findings. Be thorough but concise.",
          tools: ["Read", "Grep", "Glob", "WebSearch"],
          model: this.defaultModel,
        },
        "implementer": {
          description: "Implementation agent for writing and modifying code",
          prompt: "You are an implementation agent. Write clean, well-structured code. Follow existing patterns in the codebase.",
          tools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob"],
          model: this.defaultModel,
        },
        "reviewer": {
          description: "Code review agent for checking quality and correctness",
          prompt: "You are a code review agent. Check for bugs, security issues, and style problems. Be specific in your feedback.",
          tools: ["Read", "Grep", "Glob"],
          model: this.defaultModel,
        },
      },
      tools: ["Read", "Grep", "Glob", "Bash", "Edit", "Write", "Agent",
              "mcp__fabric__report_steps", "mcp__fabric__update_step", "mcp__fabric__complete_goal",
              ...extToolNames],
      mcpServers: { fabric: fabricTools },
      allowedTools: [
        "Read", "Grep", "Glob",
        "mcp__fabric__report_steps", "mcp__fabric__update_step", "mcp__fabric__complete_goal",
        "Agent",
      ],
      permissionMode: "default",
      maxTurns: this.defaultMaxTurns,
      maxBudgetUsd: this.defaultBudget,
      effort: "medium",
      persistSession: true,
      hooks: {
        PreToolUse: [{
          hooks: [this.createPreToolHook(goalId)],
        }],
        PostToolUse: [{
          hooks: [this.createPostToolHook(goalId)],
        }],
        PreCompact: [{
          hooks: [async (input: any) => {
            // Log compaction event and emit Fabric context for observability
            const goal = this.goals.get(goalId);
            if (!goal) return {};
            const doneSteps = goal.steps.filter(s => s.state === "done").length;
            this.emitEvent({
              type: "activity",
              goalId,
              data: {
                time: Date.now(),
                text: `<strong>system</strong> compacting context (${input.trigger || "auto"}, ${doneSteps}/${goal.steps.length} steps done, $${goal.costUsd.toFixed(2)} spent)`,
              },
            });
            return {};
          }],
        }],
        Notification: [{
          hooks: [async (input: any) => {
            if (input.message) {
              this.emitEvent({
                type: "activity",
                goalId,
                data: { time: Date.now(), text: `<strong>system</strong> ${input.message}` },
              });
            }
            return {};
          }],
        }],
      },
    });

    const prompt = `You are the Fabric orchestration agent. Your job is to accomplish the following goal:

"${description}"

IMPORTANT: You have access to Fabric tools for managing the work graph. Follow this process:

1. First, analyze what needs to be done. Think about the steps required.
2. Call the \`mcp__fabric__report_steps\` tool to report your planned steps. Use goalId: "${goalId}"
3. For each step, call \`mcp__fabric__update_step\` to mark it as "running" when you start, and "done" when complete.
4. Use subagents (researcher, implementer, reviewer) via the Agent tool for specialized work.
5. When all steps are done, call \`mcp__fabric__complete_goal\` with a summary.

Work in the current directory. Be efficient and focused.${extPromptSnippets ? `\n\n--- Extension Context ---\n${extPromptSnippets}` : ""}`;

    // Retry loop with exponential backoff (pi-mono pattern)
    let attempt = 0;
    while (true) {
      try {
        const options = buildOptions();
        // If resuming from a retry, use the session to continue
        const queryArgs = attempt > 0 && goal.sessionId
          ? { prompt, options, sessionId: goal.sessionId }
          : { prompt, options };

        const result = query(queryArgs);

        for await (const message of result) {
          this.handleSDKMessage(goalId, message);
          // Reset retry counter on any successful assistant response (pi-mono pattern)
          if (message.type === "assistant") {
            attempt = 0;
            goal.retryCount = 0;
          }
        }
        // Normal completion — break out of retry loop
        break;
      } catch (err: any) {
        if (err.name === "AbortError") {
          goal.status = "blocked";
          goal.summary = "Paused by user";
          goal.outcome = "user_abort";
          break;
        }

        // Check if error is retryable
        if (isRetryableError(err) && attempt < this.retryConfig.maxRetries) {
          attempt++;
          goal.retryCount = attempt;
          goal.lastError = err.message;
          const delay = retryDelay(attempt - 1, this.retryConfig);

          this.emitEvent({
            type: "retry",
            goalId,
            data: {
              attempt,
              maxRetries: this.retryConfig.maxRetries,
              delayMs: delay,
              error: err.message,
            },
          });
          this.emitEvent({
            type: "activity",
            goalId,
            data: {
              time: Date.now(),
              text: `<strong>system</strong> retrying (attempt ${attempt}/${this.retryConfig.maxRetries}) after ${Math.round(delay / 1000)}s — ${err.message}`,
            },
          });

          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Non-retryable or max retries exhausted
        goal.outcome = "error";
        goal.lastError = err.message;
        throw err;
      }
    }

    this.abortControllers.delete(goalId);
    this.steeringQueues.delete(goalId);

    // Notify extensions after execution
    for (const ext of this.extensions) {
      if (ext.afterGoal) {
        try { await ext.afterGoal(goalId, goal.outcome); } catch (e) { /* extension errors are non-fatal */ }
      }
    }
  }

  /**
   * Handle streaming messages from the SDK.
   */
  private handleSDKMessage(goalId: string, message: SDKMessage): void {
    const goal = this.goals.get(goalId);
    if (!goal) return;

    switch (message.type) {
      case "assistant": {
        const assistantMsg = message as SDKAssistantMessage;
        // Count turns
        goal.turnCount++;
        // Extract text content and tool calls
        for (const block of assistantMsg.message.content) {
          if (block.type === "text" && block.text.trim()) {
            this.emitEvent({
              type: "agent-message",
              goalId,
              data: { text: block.text, role: "assistant" },
            });
          }
          if (block.type === "tool_use") {
            // Don't log fabric tool calls to avoid noise
            if (!block.name.startsWith("mcp__fabric__")) {
              this.emitEvent({
                type: "activity",
                goalId,
                data: {
                  time: Date.now(),
                  text: `<strong>orchestrator</strong> called ${block.name}`,
                },
              });
            }
          }
        }
        // Track token usage and costs (model-aware pricing, inspired by pi-mono)
        const usage = (assistantMsg.message as any).usage;
        if (usage) {
          goal.inputTokens += usage.input_tokens || 0;
          goal.outputTokens += usage.output_tokens || 0;
          const pricing = MODEL_PRICING[this.defaultModel] || MODEL_PRICING.sonnet;
          goal.costUsd = (goal.inputTokens / 1_000_000) * pricing.input
                       + (goal.outputTokens / 1_000_000) * pricing.output;
          this.emitEvent({ type: "cost-update", goalId, data: { costUsd: goal.costUsd, inputTokens: goal.inputTokens, outputTokens: goal.outputTokens, model: this.defaultModel } });
        }
        // Store session ID
        if (assistantMsg.session_id) {
          goal.sessionId = assistantMsg.session_id;
        }
        break;
      }
      case "result": {
        const resultMsg = message as SDKResultMessage;
        if (resultMsg.subtype === "success") {
          goal.outcome = "success";
          if (goal.status === "active") {
            goal.status = "complete";
            goal.progress = 100;
            goal.completedAt = Date.now();
            this.emitEvent({ type: "goal-updated", goalId, data: goal });
          }
          this.emitEvent({
            type: "activity",
            goalId,
            data: { time: Date.now(), text: `<strong>orchestrator</strong> finished working on "${goal.title}"` },
          });
        } else if (resultMsg.subtype === "error_max_turns") {
          goal.outcome = "turns_exhausted";
          goal.summary = "Reached maximum turns. Partial progress saved.";
          this.emitEvent({ type: "goal-updated", goalId, data: goal });
          this.emitEvent({
            type: "toast",
            data: { title: "Turn limit", body: `Goal "${goal.title}" hit its ${this.defaultMaxTurns}-turn limit`, color: "var(--amber)" },
          });
        } else if (resultMsg.subtype === "error_max_budget_usd") {
          goal.outcome = "budget_exhausted";
          goal.summary = "Budget limit reached. Partial progress saved.";
          this.emitEvent({ type: "goal-updated", goalId, data: goal });
          this.emitEvent({
            type: "toast",
            data: { title: "Budget limit", body: `Goal "${goal.title}" hit its $${this.defaultBudget} budget cap`, color: "var(--amber)" },
          });
        }
        // Emit observability summary
        this.emitEvent({
          type: "observability",
          goalId,
          data: {
            outcome: goal.outcome,
            turnCount: goal.turnCount,
            toolCallCount: goal.toolCalls.length,
            totalCost: goal.costUsd,
            durationMs: (goal.completedAt || Date.now()) - goal.startedAt,
            toolBreakdown: this.getToolBreakdown(goalId),
          },
        });
        break;
      }
      case "system": {
        // Handle compaction boundary events
        const sysMsg = message as any;
        if (sysMsg.subtype === "compact_boundary") {
          const preTokens = sysMsg.compact_metadata?.pre_tokens || 0;
          const trigger = sysMsg.compact_metadata?.trigger || "auto";
          this.emitEvent({
            type: "activity",
            goalId,
            data: {
              time: Date.now(),
              text: `<strong>system</strong> context compacted (${trigger}, ${Math.round(preTokens / 1000)}k tokens before)`,
            },
          });
          this.emitEvent({
            type: "compaction",
            goalId,
            data: {
              trigger,
              preTokens,
              turnCount: goal.turnCount,
              costAtCompaction: goal.costUsd,
            },
          });
        }
        break;
      }
    }
  }

  /**
   * PreToolUse hook — surfaces tool usage to the UI and starts timing.
   */
  private createPreToolHook(goalId: string) {
    return async (input: any) => {
      const toolName = input.tool_name as string | undefined;
      if (toolName) {
        // Start timing this tool call
        const callId = `${goalId}:${toolName}:${Date.now()}`;
        this.pendingToolCalls.set(callId, { tool: toolName, startedAt: Date.now(), goalId });
        // Store the call ID on the input for the post-hook to find
        (input as any).__fabricCallId = callId;

        if (!toolName.startsWith("mcp__fabric__")) {
          this.emitEvent({
            type: "activity",
            goalId,
            data: {
              time: Date.now(),
              text: `<strong>agent</strong> using ${toolName}`,
            },
          });
        }
      }
      return {};
    };
  }

  /**
   * PostToolUse hook — records tool call duration and outcome for observability.
   * Also checks the steering queue (pi-mono pattern): if a human sent a message
   * while the agent was executing a tool, we inject it as context for the next turn.
   */
  private createPostToolHook(goalId: string) {
    return async (input: any) => {
      const toolName = input.tool_name as string | undefined;
      const callId = (input as any).__fabricCallId as string | undefined;
      const goal = this.goals.get(goalId);

      if (callId && this.pendingToolCalls.has(callId)) {
        const pending = this.pendingToolCalls.get(callId)!;
        this.pendingToolCalls.delete(callId);
        const durationMs = Date.now() - pending.startedAt;
        const isError = input.error != null;

        const record: ToolCallRecord = {
          tool: pending.tool,
          startedAt: pending.startedAt,
          durationMs,
          success: !isError,
          goalId,
        };

        if (goal) {
          goal.toolCalls.push(record);
        }

        this.emitEvent({
          type: "tool-call",
          goalId,
          data: record,
        });
      } else if (toolName && goal) {
        goal.toolCalls.push({
          tool: toolName,
          startedAt: Date.now(),
          durationMs: 0,
          success: input.error == null,
          goalId,
        });
      }

      // Check steering queue — inject human messages mid-execution (pi-mono pattern)
      // Uses the SDK's additionalContext on PostToolUse to surface steering to the LLM
      const steeringMessages = this.drainSteeringMessages(goalId);
      if (steeringMessages.length > 0) {
        const combined = steeringMessages.join("\n\n");
        this.emitEvent({
          type: "activity",
          goalId,
          data: { time: Date.now(), text: `<strong>system</strong> injecting steering: "${combined}"` },
        });
        return {
          hookSpecificOutput: {
            hookEventName: "PostToolUse" as const,
            additionalContext: `[HUMAN STEERING] The user has sent you a new instruction. Prioritize this:\n\n${combined}`,
          },
        };
      }

      return {};
    };
  }

  // ── Fabric Tool Handlers ──────────────────────────────

  handleStepsReported(goalId: string, steps: { name: string; estimatedAgent?: string }[], summary: string): void {
    const goal = this.goals.get(goalId);
    if (!goal) return;

    goal.steps = steps.map(s => ({
      name: s.name,
      state: "waiting" as const,
      agent: s.estimatedAgent,
    }));
    goal.summary = summary;
    goal.agentCount = 1;
    goal.progress = 5;
    goal.timeline.push({ time: Date.now(), text: `<strong>orchestrator</strong> planned ${steps.length} steps: ${summary}` });

    this.emitEvent({ type: "goal-updated", goalId, data: goal });
    this.emitEvent({
      type: "toast",
      data: { title: "Plan ready", body: `${steps.length} steps planned for "${goal.title}"`, color: "var(--blue)" },
    });
    this.emitEvent({
      type: "activity",
      goalId,
      data: { time: Date.now(), text: `<strong>orchestrator</strong> planned ${steps.length} steps for "${goal.title}"` },
    });
  }

  handleStepUpdate(goalId: string, stepIndex: number, state: string, detail?: string): void {
    const goal = this.goals.get(goalId);
    if (!goal || !goal.steps[stepIndex]) return;

    const step = goal.steps[stepIndex];
    step.state = state as FabricStep["state"];
    if (detail) step.detail = detail;
    if (state === "running") step.time = Date.now();
    if (state === "done") step.time = Date.now();

    // Recalculate progress
    const done = goal.steps.filter(s => s.state === "done").length;
    goal.progress = Math.round((done / goal.steps.length) * 90) + 5; // 5-95 range

    this.emitEvent({ type: "step-updated", goalId, data: { stepIndex, step } });
    this.emitEvent({ type: "goal-updated", goalId, data: goal });

    const verb = state === "running" ? "started" : state === "done" ? "completed" : state;
    goal.timeline.push({ time: Date.now(), text: `<strong>agent</strong> ${verb} "${step.name}"${detail ? ` — ${detail}` : ""}` });
    this.emitEvent({
      type: "activity",
      goalId,
      data: { time: Date.now(), text: `<strong>agent</strong> ${verb} "${step.name}"${detail ? ` — ${detail}` : ""}` },
    });
  }

  handleGoalComplete(goalId: string, summary: string): void {
    const goal = this.goals.get(goalId);
    if (!goal) return;

    goal.status = "complete";
    goal.progress = 100;
    goal.summary = summary;
    goal.completedAt = Date.now();
    goal.steps.forEach(s => { if (s.state !== "done") s.state = "done"; });
    goal.timeline.push({ time: Date.now(), text: `<strong>orchestrator</strong> completed goal: ${summary}` });

    this.emitEvent({ type: "goal-updated", goalId, data: goal });
    this.emitEvent({
      type: "toast",
      data: { title: "Goal complete", body: `"${goal.title}" — ${summary}`, color: "var(--green)" },
    });
    this.emitEvent({
      type: "activity",
      goalId,
      data: { time: Date.now(), text: `<strong>orchestrator</strong> completed "${goal.title}"` },
    });
  }

  /**
   * Compute tool call statistics for a goal.
   */
  private getToolBreakdown(goalId: string): Record<string, { count: number; totalMs: number; errors: number }> {
    const goal = this.goals.get(goalId);
    if (!goal) return {};
    const breakdown: Record<string, { count: number; totalMs: number; errors: number }> = {};
    for (const call of goal.toolCalls) {
      if (!breakdown[call.tool]) breakdown[call.tool] = { count: 0, totalMs: 0, errors: 0 };
      breakdown[call.tool].count++;
      breakdown[call.tool].totalMs += call.durationMs;
      if (!call.success) breakdown[call.tool].errors++;
    }
    return breakdown;
  }

  /**
   * Update engine configuration from the renderer settings panel.
   */
  updateSettings(settings: { apiKey?: string; model?: string; maxBudgetUsd?: number; maxTurns?: number }): void {
    if (settings.maxBudgetUsd !== undefined) this.defaultBudget = settings.maxBudgetUsd;
    if (settings.maxTurns !== undefined) this.defaultMaxTurns = settings.maxTurns;
    if (settings.model !== undefined) {
      const modelMap: Record<string, typeof this.defaultModel> = {
        "claude-opus-4-6": "opus",
        "claude-sonnet-4-6": "sonnet",
        "claude-haiku-4-5-20251001": "haiku",
      };
      this.defaultModel = modelMap[settings.model] ?? "sonnet" as const;
    }
  }

  /**
   * Pause/abort a running goal.
   */
  pauseGoal(goalId: string): void {
    const controller = this.abortControllers.get(goalId);
    if (controller) controller.abort();
  }

  // ── Event Emitting ──────────────────────────────────

  private emitEvent(event: FabricEvent): void {
    this.emit("fabric-event", event);
    // Notify extensions
    for (const ext of this.extensions) {
      if (ext.onEvent) {
        try { ext.onEvent(event); } catch { /* extension errors are non-fatal */ }
      }
    }
  }
}
