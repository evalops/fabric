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
}

export interface FabricEvent {
  type: "goal-created" | "goal-updated" | "step-updated" | "activity" | "attention" | "toast" | "agent-message" | "cost-update";
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

// ── Custom MCP Tools for Fabric ───────────────────────
// These tools let the agent interact with Fabric's work graph

function createFabricTools(engine: FabricEngine) {
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
    ],
  });
}

// ── Fabric Engine ─────────────────────────────────────

export class FabricEngine extends EventEmitter {
  private goals: Map<string, FabricGoal> = new Map();
  private goalCounter = 0;
  private abortControllers: Map<string, AbortController> = new Map();
  private defaultBudget = 2.00;
  private defaultMaxTurns = 30;
  private defaultModel: "sonnet" | "opus" | "haiku" | "inherit" = "sonnet";

  constructor() {
    super();
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
   * Execute a goal using the Claude Agent SDK.
   * The agent will decompose the goal into steps, then execute them.
   */
  private async executeGoal(goalId: string, description: string): Promise<void> {
    const goal = this.goals.get(goalId);
    if (!goal) return;

    const abortController = new AbortController();
    this.abortControllers.set(goalId, abortController);

    const fabricTools = createFabricTools(this);

    const options: Options = {
      abortController,
      // Use the orchestrator agent to decompose and execute
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
              "mcp__fabric__report_steps", "mcp__fabric__update_step", "mcp__fabric__complete_goal"],
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
    };

    const prompt = `You are the Fabric orchestration agent. Your job is to accomplish the following goal:

"${description}"

IMPORTANT: You have access to Fabric tools for managing the work graph. Follow this process:

1. First, analyze what needs to be done. Think about the steps required.
2. Call the \`mcp__fabric__report_steps\` tool to report your planned steps. Use goalId: "${goalId}"
3. For each step, call \`mcp__fabric__update_step\` to mark it as "running" when you start, and "done" when complete.
4. Use subagents (researcher, implementer, reviewer) via the Agent tool for specialized work.
5. When all steps are done, call \`mcp__fabric__complete_goal\` with a summary.

Work in the current directory. Be efficient and focused.`;

    try {
      const result = query({ prompt, options });

      for await (const message of result) {
        this.handleSDKMessage(goalId, message);
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        goal.status = "blocked";
        goal.summary = "Paused by user";
      } else {
        throw err;
      }
    } finally {
      this.abortControllers.delete(goalId);
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
        // Track token usage and costs
        const usage = (assistantMsg.message as any).usage;
        if (usage) {
          goal.inputTokens += usage.input_tokens || 0;
          goal.outputTokens += usage.output_tokens || 0;
          // Approximate pricing (Sonnet: $3/$15 per 1M tokens)
          goal.costUsd = (goal.inputTokens / 1_000_000) * 3 + (goal.outputTokens / 1_000_000) * 15;
          this.emitEvent({ type: "cost-update", goalId, data: { costUsd: goal.costUsd, inputTokens: goal.inputTokens, outputTokens: goal.outputTokens } });
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
          // Goal should already be marked complete by complete_goal tool
          if (goal.status === "active") {
            goal.status = "complete";
            goal.progress = 100;
            this.emitEvent({ type: "goal-updated", goalId, data: goal });
          }
          this.emitEvent({
            type: "activity",
            goalId,
            data: { time: Date.now(), text: `<strong>orchestrator</strong> finished working on "${goal.title}"` },
          });
        } else if (resultMsg.subtype === "error_max_turns") {
          goal.summary = "Reached maximum turns. Partial progress saved.";
          this.emitEvent({ type: "goal-updated", goalId, data: goal });
        } else if (resultMsg.subtype === "error_max_budget_usd") {
          goal.summary = "Budget limit reached. Partial progress saved.";
          this.emitEvent({ type: "goal-updated", goalId, data: goal });
          this.emitEvent({
            type: "toast",
            data: { title: "Budget limit", body: `Goal "${goal.title}" hit its $2 budget cap`, color: "var(--amber)" },
          });
        }
        break;
      }
    }
  }

  /**
   * PreToolUse hook — surfaces tool usage to the UI.
   */
  private createPreToolHook(goalId: string) {
    return async (input: any) => {
      const toolName = input.tool_name as string | undefined;
      if (toolName && !toolName.startsWith("mcp__fabric__")) {
        this.emitEvent({
          type: "activity",
          goalId,
          data: {
            time: Date.now(),
            text: `<strong>agent</strong> using ${toolName}`,
          },
        });
      }
      return {};
    };
  }

  /**
   * PostToolUse hook — tracks completed tool calls.
   */
  private createPostToolHook(_goalId: string) {
    return async () => {
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
  }
}
