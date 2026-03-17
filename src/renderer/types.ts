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
  // Agent reasoning and output
  thinking?: ThinkingEntry[];
  diffs?: DiffEntry[];
  files?: FileArtifact[];
}

export interface FileArtifact {
  path: string;
  action: "created" | "modified";
  sizeBytes?: number;
  time: number;
}

export interface ThinkingEntry {
  time: number;
  agent: string;
  text: string;
  collapsed?: boolean;
}

export interface DiffEntry {
  file: string;
  hunks: string;  // unified diff text
  time: number;
  agent?: string;
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
  provider: string;
  theme: "light" | "dark" | "system";
  maxBudgetUsd: number;
  maxTurns: number;
  toastNotifications: boolean;
  soundNotifications: boolean;
  showAgentMessages: boolean;

  // ── Security ────────────────────────────────
  /** Restrict which tools agents may invoke (empty = all allowed) */
  toolAllowlist: string[];
  /** Explicitly block specific tools */
  toolBlocklist: string[];
  /** Directories agents can read/write (empty = unrestricted) */
  sandboxPaths: string[];
  /** Block agents from accessing these paths */
  blockedPaths: string[];
  /** Allowed outbound domains for fetch/webhook (empty = unrestricted) */
  allowedDomains: string[];
  /** Require human approval for tool calls matching these patterns */
  humanApprovalTools: string[];
  /** Auto-redact patterns (regex) from agent output before display */
  redactPatterns: string[];

  // ── Governance ──────────────────────────────
  /** Daily spend cap across all goals (0 = unlimited) */
  dailySpendCapUsd: number;
  /** Weekly spend cap across all goals (0 = unlimited) */
  weeklySpendCapUsd: number;
  /** Max concurrent active goals (0 = unlimited) */
  maxConcurrentGoals: number;
  /** Goals exceeding this cost require human approval to continue */
  costApprovalThresholdUsd: number;
  /** Require approval when a single goal exceeds this many turns */
  turnApprovalThreshold: number;
  /** Automatically pause goals after this many consecutive errors */
  maxConsecutiveErrors: number;

  // ── Access Control ──────────────────────────
  /** SSO provider (placeholder for enterprise) */
  ssoProvider: "none" | "okta" | "azure-ad" | "google" | "custom-saml";
  /** SSO entity/tenant ID */
  ssoEntityId: string;
  /** Session timeout in minutes (0 = never) */
  sessionTimeoutMinutes: number;
  /** Require confirmation before starting goals */
  requireGoalConfirmation: boolean;
  /** IP allowlist for API server access (empty = all) */
  apiIpAllowlist: string[];

  // ── Data & Privacy ──────────────────────────
  /** Days to retain activity/cost data (0 = forever) */
  dataRetentionDays: number;
  /** Enable PII detection scanning in agent output */
  piiDetection: boolean;
  /** Auto-redact detected PII from logs */
  piiAutoRedact: boolean;
  /** Disable sending file contents to API (agents can only reference paths) */
  disableFileContentSharing: boolean;

  // ── Audit ───────────────────────────────────
  /** Enable detailed audit logging */
  auditLogEnabled: boolean;
  /** Webhook URL for audit events */
  auditWebhookUrl: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  org: string;
  costInput: number;
  costOutput: number;
  contextWindow: number;
  reasoning: boolean;
  vision: boolean;
}

export interface FabricBridge {
  createGoal(descriptionOrOpts: string | { description: string; model?: string; maxBudgetUsd?: number; maxTurns?: number }): Promise<{ success: boolean; goalId?: string; error?: string }>;
  createBatchGoals(descriptions: string[], opts?: { model?: string; maxBudgetUsd?: number; maxTurns?: number }): Promise<{ success: boolean; batchId?: string; goalIds?: string[]; error?: string }>;
  getGoals(): Promise<any[]>;
  getGoal(goalId: string): Promise<any>;
  pauseGoal(goalId: string): Promise<{ success: boolean }>;
  resumeGoal(goalId: string): Promise<{ success: boolean; error?: string }>;
  steerGoal(goalId: string, message: string): Promise<{ success: boolean }>;
  cancelGoal(goalId: string): Promise<{ success: boolean }>;
  chat(text: string, threadId: string): Promise<{ success: boolean; error?: string }>;
  onEvent(callback: (event: any) => void): () => void;
  getModels(): Promise<ModelInfo[]>;
  resolveAttention(questionId: string, response: string): Promise<{ success: boolean }>;
  updateSettings(settings: Partial<FabricSettings>): Promise<{ success: boolean }>;
  getMcpServers(): Promise<string[]>;
}

export interface GoalTemplate {
  id: string;
  name: string;
  description: string;
  model?: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  createdAt: number;
}

// ── Chat types (chat-first coordinator interface) ────
export type ChatRole = "user" | "coordinator" | "system";
export type ChatStatus = "sent" | "streaming" | "complete" | "error";

export interface ChatAction {
  label: string;
  style: "primary" | "danger" | "default";
  actionId: string;
}

export type ChatToolStatus = "running" | "done" | "error";

export interface ChatToolCall {
  tool: string;
  status: ChatToolStatus;
  input?: string;       // e.g. file path, command, pattern
  output?: string;      // truncated result summary
  durationMs?: number;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  timestamp: number;
  status: ChatStatus;
  agentSource?: string;
  goalId?: string;
  actions?: ChatAction[];
  toolCalls?: ChatToolCall[];
  costUsd?: number;
  thinking?: string;
}

export interface ChatThread {
  id: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  title?: string;
  createdAt: number;
}

export interface CmdkAction {
  icon: string;
  text: string;
  hint?: string;
  action: () => void;
}
