export type GoalStatus = "active" | "complete" | "blocked" | "failed";
export type StepState = "done" | "running" | "waiting" | "failed" | "warn";
export type GoalOutcome = "success" | "budget_exhausted" | "turns_exhausted" | "user_abort" | "error";

export interface Step {
  name: string;
  state: StepState;
  agent?: string;
  detail?: string;
  time?: number;
}

export interface ToolCallRecord {
  tool: string;
  startedAt: number;
  durationMs: number;
  success: boolean;
  goalId: string;
}

export interface Goal {
  id: string;
  title: string;
  summary: string;
  status: GoalStatus;
  progress: number;
  agentCount: number;
  steps: Step[];
  timeline: { time: number; text: string }[];
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  startedAt: number;
  completedAt?: number;
  blockedBy: string[];
  enables: string[];
  insights: Insight[];
  areasAffected: string[];
  // Observability (synced from FabricGoal)
  turnCount: number;
  toolCalls: ToolCallRecord[];
  outcome?: GoalOutcome;
  retryCount: number;
  lastError?: string;
  sessionId?: string;
}

export interface Insight {
  id: string;
  fromGoalId: string;
  text: string;
  time: number;
  relevance: "high" | "medium" | "low";
}

export interface AgentAffinity {
  agentName: string;
  count: number;
}

export interface Agent {
  id: string;
  name: string;
  capabilities: string[];
  status: "working" | "idle" | "failed";
  currentGoal?: string;
  currentStep?: string;
  tasksCompleted: number;
  avgLatency: string;
  costToday: string;
  history: { time: number; text: string }[];
  goalHistory: { goalId: string; goalTitle: string; role: string; time: number }[];
  frequentPartners: AgentAffinity[];
  successRate: number;
}

export interface Attention {
  id: string;
  kind: "warn" | "ask" | "crit";
  label: string;
  title: string;
  body: string;
  context: string;
  actions: { label: string; style: string }[];
}

export interface ActivityEvent {
  time: number;
  text: string;
}

export interface FabricSettings {
  apiKey: string;
  model: string;
  theme: "light" | "dark" | "system";
  maxBudgetUsd: number;
  maxTurns: number;
  toastNotifications: boolean;
  soundNotifications: boolean;
  showAgentMessages: boolean;
}

export interface FabricBridge {
  createGoal(description: string): Promise<{ success: boolean; goalId?: string; error?: string }>;
  getGoals(): Promise<any[]>;
  getGoal(goalId: string): Promise<any>;
  pauseGoal(goalId: string): Promise<{ success: boolean }>;
  resumeGoal(goalId: string): Promise<{ success: boolean; error?: string }>;
  steerGoal(goalId: string, message: string): Promise<{ success: boolean }>;
  onEvent(callback: (event: any) => void): () => void;
  updateSettings(settings: { apiKey?: string; model?: string; maxBudgetUsd?: number; maxTurns?: number }): Promise<{ success: boolean }>;
}

export interface CmdkAction {
  icon: string;
  text: string;
  hint?: string;
  action: () => void;
}
