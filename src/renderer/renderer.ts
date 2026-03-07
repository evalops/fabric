// ── Fabric Bridge (IPC to main process) ───────────────

interface FabricBridge {
  createGoal(description: string): Promise<{ success: boolean; goalId?: string; error?: string }>;
  getGoals(): Promise<any[]>;
  getGoal(goalId: string): Promise<any>;
  pauseGoal(goalId: string): Promise<{ success: boolean }>;
  onEvent(callback: (event: any) => void): () => void;
  updateSettings(settings: { apiKey?: string; model?: string; maxBudgetUsd?: number; maxTurns?: number }): Promise<{ success: boolean }>;
}

const bridge = (window as any).fabric as FabricBridge | undefined;

// ── Types ─────────────────────────────────────────────

type GoalStatus = "active" | "complete" | "blocked" | "failed";
type StepState = "done" | "running" | "waiting" | "warn";

interface Step {
  name: string;
  state: StepState;
  agent?: string;
  detail?: string;
  time?: number;
}

interface Goal {
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
  // Interconnection: dependencies
  blockedBy: string[];
  enables: string[];
  // Interconnection: shared context
  insights: Insight[];
  // Interconnection: impact tracking
  areasAffected: string[];
}

interface Insight {
  id: string;
  fromGoalId: string;
  text: string;
  time: number;
  relevance: "high" | "medium" | "low";
}

interface AgentAffinity {
  agentName: string;
  count: number;
}

interface Agent {
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
  // Interconnection: reputation (populated at runtime)
  goalHistory: { goalId: string; goalTitle: string; role: string; time: number }[];
  frequentPartners: AgentAffinity[];
  successRate: number;
}

interface Attention {
  id: string;
  kind: "warn" | "ask" | "crit";
  label: string;
  title: string;
  body: string;
  context: string;
  actions: { label: string; style: string }[];
}

interface ActivityEvent {
  time: number;
  text: string;
}

// ── Time helpers ──────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

function formatDuration(startedAt: number, completedAt?: number): string {
  const end = completedAt || Date.now();
  const secs = Math.floor((end - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

// ── Mock Data ─────────────────────────────────────────

const NOW = Date.now();
const MIN = 60_000;

const _rawAgents: any[] = [
  {
    id: "a-build-validator", name: "build-validator",
    capabilities: ["build-validation", "artifact-signing"],
    status: "idle", tasksCompleted: 23, avgLatency: "8s", costToday: "$0.46",
    history: [
      { time: NOW - 12 * MIN, text: "Validated build artifacts for Deploy v2.3" },
      { time: NOW - 90 * MIN, text: "Validated build artifacts for Deploy v2.2.1" },
    ],
  },
  {
    id: "a-test-runner", name: "test-runner",
    capabilities: ["integration-testing", "unit-testing", "e2e-testing"],
    status: "idle", tasksCompleted: 47, avgLatency: "45s", costToday: "$2.10",
    history: [
      { time: NOW - 8 * MIN, text: "Ran integration suite: 312/312 passed" },
      { time: NOW - 80 * MIN, text: "Ran e2e tests: 84/84 passed" },
    ],
  },
  {
    id: "a-deploy-orchestrator", name: "deploy-orchestrator",
    capabilities: ["deployment", "canary-management", "rollback"],
    status: "working", currentGoal: "Deploy v2.3 to production", currentStep: "Canary at 5% traffic",
    tasksCompleted: 12, avgLatency: "120s", costToday: "$3.80",
    history: [
      { time: NOW - 3 * MIN, text: "Started canary deployment in us-east-1" },
      { time: NOW - 45 * MIN, text: "Completed Deploy v2.2.1 rollout" },
    ],
  },
  {
    id: "a-observability", name: "observability",
    capabilities: ["monitoring", "alerting", "anomaly-detection"],
    status: "working", currentGoal: "Deploy v2.3 to production", currentStep: "Monitor for 15 minutes",
    tasksCompleted: 156, avgLatency: "1s", costToday: "$1.20",
    history: [
      { time: NOW - 3 * MIN, text: "Began monitoring canary error rate" },
      { time: NOW - 20 * MIN, text: "Detected billing anomaly pattern" },
    ],
  },
  {
    id: "a-data-analyst", name: "data-analyst",
    capabilities: ["data-analysis", "sql", "reporting"],
    status: "idle", tasksCompleted: 31, avgLatency: "18s", costToday: "$1.55",
    history: [
      { time: NOW - 6 * MIN, text: "Queried 142K transaction rows for billing investigation" },
    ],
  },
  {
    id: "a-anomaly-detector", name: "anomaly-detector",
    capabilities: ["anomaly-detection", "pattern-recognition", "clustering"],
    status: "working", currentGoal: "Investigate billing anomaly", currentStep: "Identify anomalous patterns",
    tasksCompleted: 18, avgLatency: "25s", costToday: "$2.30",
    history: [
      { time: NOW - 4 * MIN, text: "Identified 3 suspicious clusters in billing data" },
    ],
  },
  {
    id: "a-code-reviewer", name: "code-reviewer",
    capabilities: ["code-review", "security-review", "style-check"],
    status: "idle", tasksCompleted: 89, avgLatency: "4s", costToday: "$1.78",
    history: [
      { time: NOW - 30 * MIN, text: "Audited OAuth 2.0 implementation: 14 issues" },
      { time: NOW - 40 * MIN, text: "Reviewed breaking dependency changes, created 2 PRs" },
    ],
  },
  {
    id: "a-architect", name: "architect",
    capabilities: ["system-design", "migration-planning", "architecture-review"],
    status: "idle", tasksCompleted: 8, avgLatency: "35s", costToday: "$4.20",
    history: [
      { time: NOW - 20 * MIN, text: "Drafted OAuth 2.1 migration plan" },
    ],
  },
  {
    id: "a-code-gen", name: "code-gen",
    capabilities: ["code-generation", "refactoring", "implementation"],
    status: "working", currentGoal: "Refactor auth for OAuth 2.1", currentStep: "Implement PKCE flow (blocked)",
    tasksCompleted: 34, avgLatency: "8s", costToday: "$3.40",
    history: [
      { time: NOW - 15 * MIN, text: "Blocked: waiting on auth-sdk v4 release" },
    ],
  },
  {
    id: "a-profiler", name: "profiler",
    capabilities: ["performance-profiling", "bottleneck-detection"],
    status: "idle", tasksCompleted: 15, avgLatency: "12s", costToday: "$0.90",
    history: [
      { time: NOW - 45 * MIN, text: "Profiled top 20 endpoints, found 3 bottlenecks" },
    ],
  },
  {
    id: "a-db-optimizer", name: "db-optimizer",
    capabilities: ["query-optimization", "index-tuning", "schema-review"],
    status: "idle", tasksCompleted: 22, avgLatency: "15s", costToday: "$1.10",
    history: [
      { time: NOW - 25 * MIN, text: "Rewrote 3 slow queries (-73% latency)" },
    ],
  },
  {
    id: "a-infra", name: "infra",
    capabilities: ["infrastructure", "provisioning", "caching", "scaling"],
    status: "idle", tasksCompleted: 19, avgLatency: "25s", costToday: "$5.20",
    history: [
      { time: NOW - 10 * MIN, text: "Provisioned Redis cache layer (94% hit rate)" },
    ],
  },
  {
    id: "a-load-tester", name: "load-tester",
    capabilities: ["load-testing", "stress-testing", "benchmarking"],
    status: "working", currentGoal: "API latency under 200ms (P95)", currentStep: "Load test at 2x peak",
    tasksCompleted: 9, avgLatency: "120s", costToday: "$1.80",
    history: [
      { time: NOW - 5 * MIN, text: "Started 2x peak load test, current P95: 187ms" },
    ],
  },
  {
    id: "a-security-scanner", name: "security-scanner",
    capabilities: ["vulnerability-scanning", "dependency-audit", "cve-detection"],
    status: "idle", tasksCompleted: 52, avgLatency: "30s", costToday: "$0.78",
    history: [
      { time: NOW - 60 * MIN, text: "Scanned 847 production packages" },
    ],
  },
  {
    id: "a-patch-agent", name: "patch-agent",
    capabilities: ["auto-patching", "dependency-update", "pr-creation"],
    status: "idle", tasksCompleted: 41, avgLatency: "20s", costToday: "$0.62",
    history: [
      { time: NOW - 50 * MIN, text: "Auto-patched 14 non-breaking dependency updates" },
    ],
  },
  {
    id: "a-vuln-analyst", name: "vuln-analyst",
    capabilities: ["vulnerability-triage", "risk-assessment", "cve-analysis"],
    status: "idle", tasksCompleted: 28, avgLatency: "10s", costToday: "$0.56",
    history: [
      { time: NOW - 55 * MIN, text: "Triaged CVEs: 2 critical, 5 high, 12 medium" },
    ],
  },
];

// Add interconnection fields to agents
const agents: Agent[] = _rawAgents.map((a: any) => ({
  ...a,
  goalHistory: [],
  frequentPartners: [],
  successRate: 0.92 + Math.random() * 0.08,
}));

const _rawGoals: any[] = [
  {
    id: "g1",
    title: "Deploy v2.3 to production",
    summary: "Running canary at 5% traffic. Error rate looks healthy so far.",
    status: "active", progress: 68, agentCount: 3,
    costUsd: 3.42, inputTokens: 284_000, outputTokens: 91_200, startedAt: NOW - 14 * MIN,
    steps: [
      { name: "Validate build artifacts", state: "done", agent: "build-validator", detail: "All checks passed", time: NOW - 12 * MIN },
      { name: "Run integration tests", state: "done", agent: "test-runner", detail: "312 passed", time: NOW - 8 * MIN },
      { name: "Canary at 5% traffic", state: "running", agent: "deploy-orchestrator", detail: "Error rate: 0.03%", time: NOW - 3 * MIN },
      { name: "Monitor for 15 minutes", state: "running", agent: "observability", detail: "8 min remaining", time: NOW - 3 * MIN },
      { name: "Full rollout", state: "waiting" },
    ],
    timeline: [
      { time: NOW - 12 * MIN, text: "<strong>build-validator</strong> verified all artifacts" },
      { time: NOW - 10 * MIN, text: "<strong>test-runner</strong> started integration suite" },
      { time: NOW - 8 * MIN, text: "<strong>test-runner</strong> completed: 312/312 passed" },
      { time: NOW - 3 * MIN, text: "<strong>deploy-orchestrator</strong> started canary in us-east-1" },
      { time: NOW - 3 * MIN, text: "<strong>observability</strong> began monitoring error rate" },
    ],
  },
  {
    id: "g2",
    title: "Investigate billing anomaly",
    summary: "Found 3 suspicious patterns in Q1 transaction data. Narrowing down.",
    status: "active", progress: 35, agentCount: 2,
    costUsd: 1.87, inputTokens: 156_000, outputTokens: 48_300, startedAt: NOW - 20 * MIN,
    steps: [
      { name: "Query transaction logs", state: "done", agent: "data-analyst", detail: "142K rows", time: NOW - 6 * MIN },
      { name: "Identify anomalous patterns", state: "running", agent: "anomaly-detector", detail: "3 clusters found", time: NOW - 4 * MIN },
      { name: "Cross-reference with promos", state: "waiting" },
      { name: "Write root cause report", state: "waiting" },
    ],
    timeline: [
      { time: NOW - 20 * MIN, text: "Goal created by <strong>you</strong>" },
      { time: NOW - 6 * MIN, text: "<strong>data-analyst</strong> queried 142K transaction rows" },
      { time: NOW - 4 * MIN, text: "<strong>anomaly-detector</strong> identified 3 suspicious clusters" },
    ],
  },
  {
    id: "g3",
    title: "Refactor auth for OAuth 2.1",
    summary: "Blocked on auth-sdk v4 dependency. Migration plan is ready.",
    status: "blocked", progress: 22, agentCount: 1,
    costUsd: 4.65, inputTokens: 412_000, outputTokens: 78_500, startedAt: NOW - 35 * MIN,
    steps: [
      { name: "Audit current OAuth 2.0 code", state: "done", agent: "code-reviewer", detail: "14 issues", time: NOW - 30 * MIN },
      { name: "Draft migration plan", state: "done", agent: "architect", detail: "Approved", time: NOW - 20 * MIN },
      { name: "Implement PKCE flow", state: "warn", agent: "code-gen", detail: "Waiting on auth-sdk v4" },
      { name: "Update client libraries", state: "waiting" },
      { name: "Security regression tests", state: "waiting" },
    ],
    timeline: [
      { time: NOW - 35 * MIN, text: "Goal created by <strong>architect</strong>" },
      { time: NOW - 30 * MIN, text: "<strong>code-reviewer</strong> audited OAuth 2.0: 14 issues found" },
      { time: NOW - 20 * MIN, text: "<strong>architect</strong> migration plan approved" },
      { time: NOW - 15 * MIN, text: "<strong>code-gen</strong> blocked: auth-sdk v4 not yet released" },
    ],
  },
  {
    id: "g4",
    title: "API latency under 200ms (P95)",
    summary: "Load testing at 2x peak. Current P95 is 187ms \u2014 looking good.",
    status: "active", progress: 81, agentCount: 4,
    costUsd: 6.80, inputTokens: 520_000, outputTokens: 185_000, startedAt: NOW - 50 * MIN,
    steps: [
      { name: "Profile top endpoints", state: "done", agent: "profiler", detail: "Bottlenecks found", time: NOW - 45 * MIN },
      { name: "Optimize slow queries", state: "done", agent: "db-optimizer", detail: "3 queries fixed", time: NOW - 25 * MIN },
      { name: "Add Redis cache", state: "done", agent: "infra", detail: "94% hit rate", time: NOW - 10 * MIN },
      { name: "Load test at 2x peak", state: "running", agent: "load-tester", detail: "P95: 187ms", time: NOW - 5 * MIN },
      { name: "Deploy to production", state: "waiting" },
    ],
    timeline: [
      { time: NOW - 50 * MIN, text: "Goal created from alert: P95 latency at 340ms" },
      { time: NOW - 45 * MIN, text: "<strong>profiler</strong> identified 3 bottleneck endpoints" },
      { time: NOW - 25 * MIN, text: "<strong>db-optimizer</strong> rewrote queries (-73% latency)" },
      { time: NOW - 10 * MIN, text: "<strong>infra</strong> provisioned Redis cache (94% hit rate)" },
      { time: NOW - 5 * MIN, text: "<strong>load-tester</strong> started 2x peak load test" },
    ],
  },
  {
    id: "g5",
    title: "Dependency security audit",
    summary: "Complete. 2 critical CVEs patched, 14 packages updated.",
    status: "complete", progress: 100, agentCount: 0,
    costUsd: 2.14, inputTokens: 198_000, outputTokens: 42_000, startedAt: NOW - 65 * MIN, completedAt: NOW - 38 * MIN,
    steps: [
      { name: "Scan 847 packages", state: "done", agent: "security-scanner", time: NOW - 60 * MIN },
      { name: "Triage CVEs", state: "done", agent: "vuln-analyst", detail: "2 critical, 5 high", time: NOW - 55 * MIN },
      { name: "Auto-patch safe updates", state: "done", agent: "patch-agent", detail: "14 updated", time: NOW - 50 * MIN },
      { name: "Review breaking changes", state: "done", agent: "code-reviewer", detail: "2 PRs created", time: NOW - 40 * MIN },
    ],
    timeline: [
      { time: NOW - 65 * MIN, text: "Scheduled audit triggered" },
      { time: NOW - 60 * MIN, text: "<strong>security-scanner</strong> scanned 847 packages" },
      { time: NOW - 55 * MIN, text: "<strong>vuln-analyst</strong> triaged: 2 critical, 5 high, 12 medium" },
      { time: NOW - 50 * MIN, text: "<strong>patch-agent</strong> auto-patched 14 packages" },
      { time: NOW - 40 * MIN, text: "<strong>code-reviewer</strong> reviewed breaking changes, created 2 PRs" },
    ],
  },
];

// Add interconnection fields to goals
const _goalInterconnections: Record<string, Partial<Goal>> = {
  g1: {
    blockedBy: ["g5"],  // Deploy depends on security audit being done
    enables: [],
    insights: [],
    areasAffected: ["deployment", "us-east-1", "api-gateway"],
  },
  g2: {
    blockedBy: [],
    enables: [],
    insights: [
      { id: "ins-1", fromGoalId: "g3", text: "Auth refactor may affect billing validation — OAuth tokens used in payment verification", time: NOW - 8 * MIN, relevance: "medium" },
    ],
    areasAffected: ["billing", "transactions", "reporting"],
  },
  g3: {
    blockedBy: [],
    enables: ["g1"],  // OAuth fix enables safer deployments
    insights: [
      { id: "ins-2", fromGoalId: "g5", text: "Security audit found 3 issues related to OAuth 2.0 — these align with your migration plan", time: NOW - 30 * MIN, relevance: "high" },
    ],
    areasAffected: ["auth", "oauth", "client-libraries", "security"],
  },
  g4: {
    blockedBy: [],
    enables: ["g1"],  // Latency fix enables deploy confidence
    insights: [
      { id: "ins-3", fromGoalId: "g2", text: "Billing investigation found /api/billing endpoint has 340ms P95 — may be related to your latency target", time: NOW - 6 * MIN, relevance: "high" },
    ],
    areasAffected: ["api-endpoints", "database", "caching", "performance"],
  },
  g5: {
    blockedBy: [],
    enables: ["g3"],  // Security audit enables auth refactor
    insights: [],
    areasAffected: ["dependencies", "security", "packages"],
  },
};

const goals: Goal[] = _rawGoals.map((g: any) => ({
  ...g,
  blockedBy: _goalInterconnections[g.id]?.blockedBy || [],
  enables: _goalInterconnections[g.id]?.enables || [],
  insights: _goalInterconnections[g.id]?.insights || [],
  areasAffected: _goalInterconnections[g.id]?.areasAffected || [],
}));

// Build agent reputation from goal data
function buildAgentReputation(): void {
  goals.forEach(g => {
    const agentNames = [...new Set(g.steps.filter((s: Step) => s.agent).map((s: Step) => s.agent!))];
    agentNames.forEach(name => {
      const agent = agents.find(a => a.name === name);
      if (agent && !agent.goalHistory.find(h => h.goalId === g.id)) {
        agent.goalHistory.push({ goalId: g.id, goalTitle: g.title, role: agent.capabilities[0] || "general", time: g.startedAt });
      }
    });
  });
  agents.forEach(a => {
    const partnerCounts: Record<string, number> = {};
    a.goalHistory.forEach(h => {
      const goal = goals.find(g => g.id === h.goalId);
      if (!goal) return;
      const coworkers = [...new Set(goal.steps.filter((s: Step) => s.agent && s.agent !== a.name).map((s: Step) => s.agent!))];
      coworkers.forEach(name => { partnerCounts[name] = (partnerCounts[name] || 0) + 1; });
    });
    a.frequentPartners = Object.entries(partnerCounts)
      .sort(([, x], [, y]) => y - x)
      .slice(0, 3)
      .map(([agentName, count]) => ({ agentName, count }));
  });
}

const attentionItems: Attention[] = [
  {
    id: "a1", kind: "warn", label: "Approaching threshold",
    title: "Canary error rate rising",
    body: "The canary deployment for v2.3 has an error rate of 0.08%, approaching the 0.1% threshold. Errors are concentrated in the checkout endpoint.",
    context: "error rate: 0.08% / 0.1% threshold  \u00b7  ~340 users affected  \u00b7  $2.40 spent",
    actions: [
      { label: "Investigate", style: "btn-primary" },
      { label: "Continue rollout", style: "" },
      { label: "Rollback", style: "btn-danger" },
    ],
  },
  {
    id: "a2", kind: "ask", label: "New goal proposed",
    title: "Migrate auth to OAuth 2.1",
    body: "An agent proposes refactoring the auth module to the OAuth 2.1 spec. This would fix 3 of 14 security issues found in the recent audit.",
    context: "cost: ~$14  \u00b7  time: ~40 min  \u00b7  risk: low  \u00b7  fixes 3 audit issues",
    actions: [
      { label: "Approve", style: "btn-primary" },
      { label: "Edit constraints", style: "" },
      { label: "Reject", style: "btn-danger" },
    ],
  },
];

const activityLog: ActivityEvent[] = [
  { time: NOW - 10_000, text: "<strong>load-tester</strong> reported P95 latency at 187ms" },
  { time: NOW - 25_000, text: "<strong>observability</strong> checked canary error rate: 0.03%" },
  { time: NOW - 55_000, text: "<strong>anomaly-detector</strong> found 3 clusters in billing data" },
  { time: NOW - 80_000, text: "<strong>deploy-orchestrator</strong> started canary in us-east-1" },
  { time: NOW - 120_000, text: "<strong>infra</strong> finished provisioning Redis cache" },
  { time: NOW - 160_000, text: "<strong>data-analyst</strong> completed transaction log query" },
  { time: NOW - 200_000, text: "<strong>test-runner</strong> passed all 312 integration tests" },
  { time: NOW - 260_000, text: "<strong>db-optimizer</strong> rewrote 3 slow queries" },
  { time: NOW - 300_000, text: "<strong>security-scanner</strong> finished scanning 847 packages" },
];

// ── Settings ──────────────────────────────────────────

interface FabricSettings {
  apiKey: string;
  model: string;
  theme: "light" | "dark" | "system";
  maxBudgetUsd: number;
  maxTurns: number;
  toastNotifications: boolean;
  soundNotifications: boolean;
  showAgentMessages: boolean;
}

const SETTINGS_KEY = "fabric:settings:v1";

const DEFAULT_SETTINGS: FabricSettings = {
  apiKey: "",
  model: "claude-sonnet-4-6",
  theme: "light",
  maxBudgetUsd: 2.00,
  maxTurns: 30,
  toastNotifications: true,
  soundNotifications: false,
  showAgentMessages: true,
};

function loadSettings(): FabricSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: FabricSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  applyTheme(settings.theme);
  if (bridge) {
    bridge.updateSettings({
      apiKey: settings.apiKey,
      model: settings.model,
      maxBudgetUsd: settings.maxBudgetUsd,
      maxTurns: settings.maxTurns,
    });
  }
}

let settings = loadSettings();

function applyTheme(theme: FabricSettings["theme"]): void {
  let shouldBeDark = false;
  if (theme === "dark") shouldBeDark = true;
  else if (theme === "system") shouldBeDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  darkMode = shouldBeDark;
  document.body.classList.toggle("dark", shouldBeDark);
  const btn = document.getElementById("dark-mode-toggle");
  if (btn) btn.textContent = shouldBeDark ? "\u2600" : "\u263e";
}

function showSettingsSaved(): void {
  const el = document.querySelector(".settings-saved");
  if (!el) return;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1500);
}

function renderSettings(): void {
  const feed = document.getElementById("feed")!;
  const masked = settings.apiKey ? "\u2022".repeat(8) + settings.apiKey.slice(-4) : "";

  feed.innerHTML = `<div class="settings-view">
    <!-- Appearance -->
    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Appearance</div>
        <div class="settings-card-desc">Control the look and feel of Fabric</div>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Theme</div>
          <div class="settings-row-hint">Choose between light, dark, or follow your system preference</div>
        </div>
        <div class="settings-theme-group">
          <div class="settings-theme-option${settings.theme === "light" ? " active" : ""}" data-theme="light">Light</div>
          <div class="settings-theme-option${settings.theme === "dark" ? " active" : ""}" data-theme="dark">Dark</div>
          <div class="settings-theme-option${settings.theme === "system" ? " active" : ""}" data-theme="system">System</div>
        </div>
      </div>
    </div>

    <!-- API Configuration -->
    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">API Configuration</div>
        <div class="settings-card-desc">Configure your Anthropic API key for agent execution</div>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">API Key</div>
          <div class="settings-row-hint">Your Anthropic API key. Stored locally, never sent anywhere except the Anthropic API.</div>
        </div>
        <input class="settings-input mono" id="settings-api-key" type="password" placeholder="sk-ant-..." value="${masked}" />
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Model</div>
          <div class="settings-row-hint">Default model used for orchestration and subagents</div>
        </div>
        <select class="settings-select" id="settings-model">
          <option value="claude-opus-4-6"${settings.model === "claude-opus-4-6" ? " selected" : ""}>Claude Opus 4.6</option>
          <option value="claude-sonnet-4-6"${settings.model === "claude-sonnet-4-6" ? " selected" : ""}>Claude Sonnet 4.6</option>
          <option value="claude-haiku-4-5-20251001"${settings.model === "claude-haiku-4-5-20251001" ? " selected" : ""}>Claude Haiku 4.5</option>
        </select>
      </div>
    </div>

    <!-- Agent Defaults -->
    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Agent Defaults</div>
        <div class="settings-card-desc">Default limits applied to each new goal</div>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Budget per goal</div>
          <div class="settings-row-hint">Maximum spend in USD before a goal is paused</div>
        </div>
        <input class="settings-input settings-number" id="settings-budget" type="number" min="0.50" max="50" step="0.50" value="${settings.maxBudgetUsd}" />
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Max turns per goal</div>
          <div class="settings-row-hint">Maximum agent conversation turns before stopping</div>
        </div>
        <input class="settings-input settings-number" id="settings-max-turns" type="number" min="5" max="100" step="5" value="${settings.maxTurns}" />
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Show agent messages</div>
          <div class="settings-row-hint">Display raw agent text in the activity feed</div>
        </div>
        <label class="settings-switch">
          <input type="checkbox" id="settings-agent-messages" ${settings.showAgentMessages ? "checked" : ""} />
          <span class="settings-switch-track"></span>
        </label>
      </div>
    </div>

    <!-- Notifications -->
    <div class="settings-card">
      <div class="settings-card-header">
        <div class="settings-card-title">Notifications</div>
        <div class="settings-card-desc">Control how Fabric notifies you about events</div>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Toast notifications</div>
          <div class="settings-row-hint">Show pop-up notifications for important events</div>
        </div>
        <label class="settings-switch">
          <input type="checkbox" id="settings-toast" ${settings.toastNotifications ? "checked" : ""} />
          <span class="settings-switch-track"></span>
        </label>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="settings-row-label">Sound notifications</div>
          <div class="settings-row-hint">Play a sound when an agent needs your attention</div>
        </div>
        <label class="settings-switch">
          <input type="checkbox" id="settings-sound" ${settings.soundNotifications ? "checked" : ""} />
          <span class="settings-switch-track"></span>
        </label>
      </div>
    </div>

    <!-- Reset -->
    <div style="display: flex; align-items: center; justify-content: space-between;">
      <button class="settings-reset" id="settings-reset">Reset all settings to defaults</button>
      <span class="settings-saved">Saved</span>
    </div>
  </div>`;

  // ── Wire up settings interactions ──

  // Theme buttons
  feed.querySelectorAll(".settings-theme-option").forEach(el => {
    el.addEventListener("click", () => {
      const theme = (el as HTMLElement).dataset.theme as FabricSettings["theme"];
      settings.theme = theme;
      saveSettings(settings);
      feed.querySelectorAll(".settings-theme-option").forEach(o => o.classList.toggle("active", (o as HTMLElement).dataset.theme === theme));
      showSettingsSaved();
    });
  });

  // API key
  const apiKeyInput = document.getElementById("settings-api-key") as HTMLInputElement;
  let apiKeyFocused = false;
  apiKeyInput.addEventListener("focus", () => {
    if (!apiKeyFocused) {
      apiKeyFocused = true;
      apiKeyInput.type = "text";
      apiKeyInput.value = settings.apiKey;
    }
  });
  apiKeyInput.addEventListener("blur", () => {
    apiKeyFocused = false;
    settings.apiKey = apiKeyInput.value;
    saveSettings(settings);
    apiKeyInput.type = "password";
    apiKeyInput.value = settings.apiKey ? "\u2022".repeat(8) + settings.apiKey.slice(-4) : "";
    showSettingsSaved();
  });

  // Model select
  (document.getElementById("settings-model") as HTMLSelectElement).addEventListener("change", (e) => {
    settings.model = (e.target as HTMLSelectElement).value;
    saveSettings(settings);
    showSettingsSaved();
  });

  // Budget
  (document.getElementById("settings-budget") as HTMLInputElement).addEventListener("change", (e) => {
    settings.maxBudgetUsd = parseFloat((e.target as HTMLInputElement).value) || DEFAULT_SETTINGS.maxBudgetUsd;
    saveSettings(settings);
    showSettingsSaved();
  });

  // Max turns
  (document.getElementById("settings-max-turns") as HTMLInputElement).addEventListener("change", (e) => {
    settings.maxTurns = parseInt((e.target as HTMLInputElement).value) || DEFAULT_SETTINGS.maxTurns;
    saveSettings(settings);
    showSettingsSaved();
  });

  // Toggle switches
  (document.getElementById("settings-agent-messages") as HTMLInputElement).addEventListener("change", (e) => {
    settings.showAgentMessages = (e.target as HTMLInputElement).checked;
    saveSettings(settings);
    showSettingsSaved();
  });
  (document.getElementById("settings-toast") as HTMLInputElement).addEventListener("change", (e) => {
    settings.toastNotifications = (e.target as HTMLInputElement).checked;
    saveSettings(settings);
    showSettingsSaved();
  });
  (document.getElementById("settings-sound") as HTMLInputElement).addEventListener("change", (e) => {
    settings.soundNotifications = (e.target as HTMLInputElement).checked;
    saveSettings(settings);
    showSettingsSaved();
  });

  // Reset
  document.getElementById("settings-reset")!.addEventListener("click", () => {
    settings = { ...DEFAULT_SETTINGS };
    saveSettings(settings);
    renderSettings();
    showSettingsSaved();
  });
}

// ── Dark Mode ─────────────────────────────────────────

let darkMode = false;

function toggleDarkMode(): void {
  darkMode = !darkMode;
  settings.theme = darkMode ? "dark" : "light";
  saveSettings(settings);
  document.body.classList.toggle("dark", darkMode);
  const btn = document.getElementById("dark-mode-toggle");
  if (btn) btn.textContent = darkMode ? "\u2600" : "\u263e";
}

// ── Simulation ────────────────────────────────────────

const simEvents = [
  { text: "<strong>observability</strong> checked canary error rate: 0.04%", toast: null as null | { title: string; body: string; color: string } },
  { text: "<strong>load-tester</strong> reported P95 latency at 184ms", toast: null },
  { text: "<strong>anomaly-detector</strong> narrowed billing issue to 2 merchants", toast: null },
  { text: "<strong>deploy-orchestrator</strong> expanded canary to us-west-2", toast: { title: "Canary expanded", body: "Now serving 5% traffic in us-west-2", color: "var(--blue)" } },
  { text: "<strong>code-gen</strong> still waiting on auth-sdk v4", toast: null },
  { text: "<strong>observability</strong> checked canary error rate: 0.05%", toast: null },
  { text: "<strong>profiler</strong> found new slow query in /api/search", toast: { title: "New issue detected", body: "Slow query in /api/search endpoint", color: "var(--amber)" } },
  { text: "<strong>load-tester</strong> reported P95 latency at 179ms", toast: null },
  { text: "<strong>data-analyst</strong> correlated anomaly with March promo", toast: null },
  { text: "<strong>deploy-orchestrator</strong> expanded canary to eu-west-1", toast: null },
  { text: "<strong>patch-agent</strong> created PR #482: update lodash", toast: { title: "PR created", body: "patch-agent opened PR #482 to fix CVE-2026-1847", color: "var(--green)" } },
  { text: "<strong>anomaly-detector</strong> root cause: double-charge on retry", toast: { title: "Root cause found", body: "Billing anomaly: double-charge triggered on payment retry", color: "var(--green)" } },
  { text: "<strong>load-tester</strong> completed load test \u2014 P95: 176ms", toast: { title: "Load test passed", body: "P95 latency at 176ms, under 200ms target", color: "var(--green)" } },
];

let simIdx = 0;

function simulateTick(): void {
  const ev = simEvents[simIdx % simEvents.length];
  simIdx++;

  activityLog.unshift({ time: Date.now(), text: ev.text });
  if (activityLog.length > 50) activityLog.pop();

  if (ev.toast) showToast(ev.toast.title, ev.toast.body, ev.toast.color);

  goals.forEach(g => {
    if (g.status === "active") {
      if (g.progress < 95) g.progress = Math.min(95, g.progress + Math.random() * 1.5);
      g.costUsd += Math.random() * 0.15;
      g.inputTokens += Math.floor(Math.random() * 8000);
      g.outputTokens += Math.floor(Math.random() * 3000);
    }
  });

  const footerSpend = document.getElementById("footer-spend");
  if (footerSpend) footerSpend.textContent = `$${getTotalCost().toFixed(2)} today`;

  if (currentView === "activity") renderActivity();
  if (currentView === "agents") renderAgents();
  if (currentView === "graph") renderGraph();
  if (currentView === "costs") renderCosts();
  renderSidebarGoals();
  renderTitleStatus();
}

// ── Toasts ────────────────────────────────────────────

function showToast(title: string, body: string, accentColor: string): void {
  if (!settings.toastNotifications) return;
  const container = document.getElementById("toast-container")!;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <div class="toast-accent" style="background: ${accentColor}"></div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-body">${body}</div>
    </div>
    <span class="toast-time">now</span>
  `;
  toast.addEventListener("click", () => dismissToast(toast));
  container.appendChild(toast);
  setTimeout(() => dismissToast(toast), 5000);
}

function dismissToast(toast: HTMLElement): void {
  if (toast.classList.contains("exiting")) return;
  toast.classList.add("exiting");
  setTimeout(() => toast.remove(), 300);
}

// ── Command Bar ───────────────────────────────────────

interface CmdkAction {
  icon: string;
  text: string;
  hint?: string;
  action: () => void;
}

function getCmdkActions(query: string): { group: string; items: CmdkAction[] }[] {
  const q = query.toLowerCase().trim();

  // Check for goal creation intent
  const createMatch = q.match(/^(?:create|new|add|start|make)\s+(?:goal|task)?:?\s*(.+)/);
  if (createMatch) {
    return [{
      group: "Create goal",
      items: [{
        icon: "+",
        text: `Create: "${createMatch[1]}"`,
        hint: "enter to create",
        action: () => { closeCmdk(); createGoalFromNL(createMatch[1]); },
      }],
    }];
  }

  const commandActions: CmdkAction[] = [];
  if (q.includes("pause") || q.includes("stop")) {
    commandActions.push({ icon: "\u23f8", text: "Pause all active deployments", hint: "command", action: () => { closeCmdk(); showToast("Deployments paused", "All active deployments have been paused", "var(--amber)"); activityLog.unshift({ time: Date.now(), text: "<strong>you</strong> paused all active deployments" }); } });
  }
  if (q.includes("rollback") || q.includes("revert")) {
    commandActions.push({ icon: "\u21a9", text: "Rollback Deploy v2.3", hint: "command", action: () => { closeCmdk(); showToast("Rolling back", "Deploy v2.3 canary is being rolled back", "var(--red)"); activityLog.unshift({ time: Date.now(), text: "<strong>you</strong> triggered rollback on Deploy v2.3" }); } });
  }
  if (q.includes("budget") || q.includes("spend") || q.includes("cost")) {
    commandActions.push({ icon: "$", text: `Today's spend: $${getTotalCost().toFixed(2)}`, hint: "info", action: () => { closeCmdk(); switchView("costs"); } });
  }
  if (q.includes("dark") || q.includes("light") || q.includes("theme") || q.includes("mode")) {
    commandActions.push({ icon: darkMode ? "\u2600" : "\u263e", text: `Switch to ${darkMode ? "light" : "dark"} mode`, hint: "theme", action: () => { closeCmdk(); toggleDarkMode(); } });
  }
  if (q.includes("agent") && !q.includes("how")) {
    const matchedAgents = agents.filter(a => a.name.includes(q.replace("agent", "").trim()) || q === "agent" || q === "agents");
    matchedAgents.slice(0, 5).forEach(a => {
      commandActions.push({ icon: a.status === "working" ? "\u25cf" : "\u25cb", text: a.name, hint: a.status, action: () => { closeCmdk(); openAgentDetail(a.id); } });
    });
  }

  const goalActions: CmdkAction[] = goals
    .filter(g => g.title.toLowerCase().includes(q) || q === "")
    .map(g => ({
      icon: g.status === "complete" ? "\u2713" : g.status === "blocked" ? "!" : "\u25cf",
      text: g.title,
      hint: `${Math.round(g.progress)}%`,
      action: () => { closeCmdk(); openGoalDetail(g.id); },
    }));

  const navActions: CmdkAction[] = [
    { icon: "!", text: "Needs You", hint: "view", action: () => { closeCmdk(); switchView("needs-you"); } },
    { icon: "\u25c7", text: "All Work", hint: "view", action: () => { closeCmdk(); switchView("all-work"); } },
    { icon: "\u22ee", text: "Activity", hint: "view", action: () => { closeCmdk(); switchView("activity"); } },
    { icon: "\u2726", text: "Agents", hint: "view", action: () => { closeCmdk(); switchView("agents"); } },
    { icon: "\u25ce", text: "Graph", hint: "view", action: () => { closeCmdk(); switchView("graph"); } },
    { icon: "$", text: "Costs", hint: "view", action: () => { closeCmdk(); switchView("costs"); } },
    { icon: "\u2699", text: "Settings", hint: "view", action: () => { closeCmdk(); switchView("settings"); } },
  ].filter(a => a.text.toLowerCase().includes(q) || q === "");

  const groups: { group: string; items: CmdkAction[] }[] = [];
  if (commandActions.length) groups.push({ group: "Commands", items: commandActions });
  if (q.length === 0 || goalActions.length) groups.push({ group: "Goals", items: goalActions.length ? goalActions : goals.map(g => ({
    icon: g.status === "complete" ? "\u2713" : g.status === "blocked" ? "!" : "\u25cf",
    text: g.title, hint: `${Math.round(g.progress)}%`,
    action: () => { closeCmdk(); openGoalDetail(g.id); },
  }))});
  if (navActions.length) groups.push({ group: "Navigate", items: navActions });
  return groups;
}

let cmdkSelectedIdx = 0;

function renderCmdkResults(query: string): void {
  const results = document.getElementById("cmdk-results")!;
  const groups = getCmdkActions(query);

  if (query.length > 2 && groups.every(g => g.items.length === 0)) {
    results.innerHTML = `<div class="cmdk-response">${getSmartResponse(query)}</div>`;
    (window as any).__cmdkItems = [];
    return;
  }

  let idx = 0;
  results.innerHTML = groups.map(group => `
    <div class="cmdk-group-label">${group.group}</div>
    ${group.items.map(item => {
      const html = `
        <div class="cmdk-item${idx === cmdkSelectedIdx ? " selected" : ""}" data-idx="${idx}">
          <span class="cmdk-item-icon">${item.icon}</span>
          <span class="cmdk-item-text">${item.text}</span>
          ${item.hint ? `<span class="cmdk-item-hint">${item.hint}</span>` : ""}
        </div>
      `;
      idx++;
      return html;
    }).join("")}
  `).join("");

  const allItems = groups.flatMap(g => g.items);
  (window as any).__cmdkItems = allItems;

  results.querySelectorAll(".cmdk-item").forEach(el => {
    el.addEventListener("mouseenter", () => {
      cmdkSelectedIdx = parseInt((el as HTMLElement).dataset.idx || "0");
      results.querySelectorAll(".cmdk-item").forEach(e => e.classList.remove("selected"));
      el.classList.add("selected");
    });
    el.addEventListener("click", () => {
      const i = parseInt((el as HTMLElement).dataset.idx || "0");
      allItems[i]?.action();
    });
  });
}

function getSmartResponse(query: string): string {
  const q = query.toLowerCase();
  if (q.includes("deploy") || q.includes("v2.3") || q.includes("canary")) {
    return `<strong>Deploy v2.3</strong> is ${Math.round(goals[0].progress)}% complete. Canary is running at 5% traffic in us-east-1 with a 0.03% error rate (threshold: 0.1%). 3 agents working on it.<br><br><span class="cmdk-response-action" data-goal="g1">View goal \u2192</span>`;
  }
  if (q.includes("billing") || q.includes("anomaly")) {
    return `The <strong>billing investigation</strong> is ${Math.round(goals[1].progress)}% complete. 3 suspicious clusters found in Q1 data. Next step: cross-reference with promos.<br><br><span class="cmdk-response-action" data-goal="g2">View goal \u2192</span>`;
  }
  if (q.includes("auth") || q.includes("oauth")) {
    return `The <strong>OAuth 2.1 refactor</strong> is blocked at ${Math.round(goals[2].progress)}%. Waiting on auth-sdk v4. Migration plan approved.<br><br><span class="cmdk-response-action" data-goal="g3">View goal \u2192</span>`;
  }
  if (q.includes("latency") || q.includes("p95")) {
    return `<strong>API latency</strong> optimization is ${Math.round(goals[3].progress)}% complete. Current P95: 187ms (target: 200ms). Load test in progress.<br><br><span class="cmdk-response-action" data-goal="g4">View goal \u2192</span>`;
  }
  if (q.includes("status") || q.includes("overview") || q.includes("how") || q.includes("what")) {
    const active = goals.filter(g => g.status === "active").length;
    const blocked = goals.filter(g => g.status === "blocked").length;
    const working = agents.filter(a => a.status === "working").length;
    return `<strong>${active} goals active</strong>, ${blocked} blocked. ${working} agents working, ${agents.length - working} idle. Spend today: <strong>$${getTotalCost().toFixed(2)}</strong>. ${attentionItems.length} items need your attention.`;
  }
  return `Try: <strong>"status"</strong> for an overview, a goal name, <strong>"create: [description]"</strong> to start a new goal, <strong>"rollback"</strong> or <strong>"pause"</strong> for commands, or <strong>"dark mode"</strong>.`;
}

function openCmdk(): void {
  const overlay = document.getElementById("cmdk-overlay")!;
  const input = document.getElementById("cmdk-input") as HTMLInputElement;
  overlay.classList.add("open");
  input.value = "";
  input.focus();
  cmdkSelectedIdx = 0;
  renderCmdkResults("");
}

function closeCmdk(): void {
  document.getElementById("cmdk-overlay")!.classList.remove("open");
}

// ── Goal Creation (Natural Language) ──────────────────

async function createGoalFromNL(description: string): Promise<void> {
  if (bridge) {
    // ── REAL MODE: Use Claude Agent SDK via IPC ──
    const result = await bridge.createGoal(description);
    if (!result.success) {
      showToast("Error", result.error || "Failed to create goal", "var(--red)");
      return;
    }
    // The engine will send events via bridge.onEvent — the UI will update reactively.
    // Create a placeholder in local state that will be updated by events.
    const title = description.charAt(0).toUpperCase() + description.slice(1);
    const placeholder: Goal = {
      id: result.goalId!,
      title,
      summary: "Agents are analyzing and planning steps...",
      status: "active",
      progress: 0,
      agentCount: 0,
      steps: [],
      timeline: [{ time: Date.now(), text: `Goal created by <strong>you</strong>` }],
      costUsd: 0, inputTokens: 0, outputTokens: 0, startedAt: Date.now(),
      blockedBy: [], enables: [], insights: [], areasAffected: [],
    };
    goals.unshift(placeholder);
    activityLog.unshift({ time: Date.now(), text: `<strong>you</strong> created goal: "${title}"` });
    renderSidebarGoals();
    renderTitleStatus();
    switchView("all-work");
  } else {
    // ── MOCK MODE: Simulate goal creation ──
    const newId = `g${goals.length + 1}`;
    const newGoal: Goal = {
      id: newId,
      title: description.charAt(0).toUpperCase() + description.slice(1),
      summary: "Just created. Agents are analyzing and planning steps...",
      status: "active",
      progress: 0,
      agentCount: 0,
      steps: [
        { name: "Analyze requirements", state: "running", agent: "architect", time: Date.now() },
        { name: "Plan execution steps", state: "waiting" },
        { name: "Execute plan", state: "waiting" },
        { name: "Validate results", state: "waiting" },
      ],
      timeline: [
        { time: Date.now(), text: "Goal created by <strong>you</strong>" },
        { time: Date.now(), text: "<strong>architect</strong> began analyzing requirements" },
      ],
      costUsd: 0, inputTokens: 0, outputTokens: 0, startedAt: Date.now(),
      blockedBy: [], enables: [], insights: [], areasAffected: [],
    };

    goals.unshift(newGoal);
    activityLog.unshift({ time: Date.now(), text: `<strong>you</strong> created goal: "${newGoal.title}"` });
    showToast("Goal created", `"${newGoal.title}" \u2014 agents are picking it up`, "var(--accent)");

    setTimeout(() => {
      newGoal.agentCount = 1;
      newGoal.progress = 8;
      newGoal.summary = "Architect is analyzing requirements and planning steps.";
      newGoal.timeline.push({ time: Date.now(), text: "<strong>architect</strong> identified 3 sub-tasks" });
      activityLog.unshift({ time: Date.now(), text: `<strong>architect</strong> picked up "${newGoal.title}"` });
      renderSidebarGoals();
      if (currentView === "all-work") renderAllWork();
      if (currentView === "activity") renderActivity();
      showToast("Agent assigned", `architect is now working on "${newGoal.title}"`, "var(--blue)");
    }, 3000);

    setTimeout(() => {
      newGoal.steps[0].state = "done";
      newGoal.steps[0].time = Date.now();
      newGoal.steps[1].state = "running";
      newGoal.steps[1].agent = "architect";
      newGoal.steps[1].time = Date.now();
      newGoal.progress = 20;
      newGoal.agentCount = 2;
      newGoal.summary = "Requirements analyzed. Planning execution steps...";
      newGoal.timeline.push({ time: Date.now(), text: "<strong>architect</strong> completed requirements analysis" });
      activityLog.unshift({ time: Date.now(), text: `<strong>architect</strong> analyzed requirements for "${newGoal.title}"` });
      renderSidebarGoals();
      if (currentView === "all-work") renderAllWork();
      if (currentView === "activity") renderActivity();
    }, 8000);

    renderSidebarGoals();
    renderTitleStatus();
    switchView("all-work");
  }
}

// ── Agent Detail Panel ────────────────────────────────

function openAgentDetail(agentId: string): void {
  const agent = agents.find(a => a.id === agentId);
  if (!agent) return;

  const overlay = document.getElementById("detail-overlay")!;
  const panel = document.getElementById("detail-panel")!;

  const statusColor = agent.status === "working" ? "var(--blue)" : agent.status === "idle" ? "var(--green)" : "var(--red)";

  panel.innerHTML = `
    <div class="detail-back">\u2190 Back</div>

    <div class="agent-header">
      <div class="agent-avatar" style="background: ${stringToColor(agent.name)}">${agent.name.charAt(0).toUpperCase()}</div>
      <div>
        <div class="detail-title">${agent.name}</div>
        <div class="agent-status-line">
          <span class="agent-status-dot" style="background: ${statusColor}"></span>
          <span>${agent.status}${agent.currentStep ? ` \u2014 ${agent.currentStep}` : ""}</span>
        </div>
      </div>
    </div>

    <div class="detail-meta">
      <div class="detail-meta-item">
        <span class="detail-meta-label">Tasks today</span>
        <span class="detail-meta-value">${agent.tasksCompleted}</span>
      </div>
      <div class="detail-meta-item">
        <span class="detail-meta-label">Avg latency</span>
        <span class="detail-meta-value">${agent.avgLatency}</span>
      </div>
      <div class="detail-meta-item">
        <span class="detail-meta-label">Cost today</span>
        <span class="detail-meta-value">${agent.costToday}</span>
      </div>
    </div>

    <div class="detail-meta" style="margin-top: 0;">
      <div class="detail-meta-item">
        <span class="detail-meta-label">Success rate</span>
        <span class="detail-meta-value">${Math.round(agent.successRate * 100)}%</span>
      </div>
      <div class="detail-meta-item">
        <span class="detail-meta-label">Goals worked</span>
        <span class="detail-meta-value">${agent.goalHistory.length}</span>
      </div>
    </div>

    <div class="detail-section-title">Capabilities</div>
    <div class="agent-caps">
      ${agent.capabilities.map(c => `<span class="agent-cap-tag">${c}</span>`).join("")}
    </div>

    ${agent.frequentPartners.length > 0 ? `
      <div class="detail-section-title">Frequently works with</div>
      <div class="agent-roster" style="margin-bottom: 16px;">
        ${agent.frequentPartners.map(p => {
          const partner = agents.find(a => a.name === p.agentName);
          return `<div class="agent-roster-item" data-agent="${partner?.id || ""}" title="${p.count} shared goal${p.count > 1 ? "s" : ""}">
            <div class="agent-avatar-sm" style="background: ${stringToColor(p.agentName)}">${p.agentName.charAt(0).toUpperCase()}</div>
            <span>${p.agentName}</span>
            <span style="font-size: 11px; color: var(--text-muted);">\u00d7${p.count}</span>
          </div>`;
        }).join("")}
      </div>
    ` : ""}

    ${agent.currentGoal ? `
      <div class="detail-section-title">Currently working on</div>
      <div class="agent-current-goal" data-goal="${goals.find(g => g.title === agent.currentGoal)?.id || ""}">
        <span>${agent.currentGoal}</span>
        <span class="cmdk-item-hint">\u2192</span>
      </div>
    ` : ""}

    ${agent.goalHistory.length > 0 ? `
      <div class="detail-section-title">Goal history</div>
      <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 16px;">
        ${agent.goalHistory.map(h => {
          const hGoal = goals.find(g => g.id === h.goalId);
          return `<div class="interconnect-link" data-goal="${h.goalId}" style="display: flex; align-items: center; gap: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer; border-radius: var(--radius-xs);">
            ${hGoal ? `<span class="goal-indicator ind-${hGoal.status}" style="margin: 0;"></span>` : ""}
            <span style="font-weight: 500;">${h.goalTitle}</span>
            <span style="color: var(--text-muted); margin-left: auto;">${h.role} \u00b7 ${relativeTime(h.time)}</span>
          </div>`;
        }).join("")}
      </div>
    ` : ""}

    <div class="detail-section-title">Recent activity</div>
    ${agent.history.map(ev => `
      <div class="detail-timeline-item">
        <span class="detail-timeline-time">${relativeTime(ev.time)}</span>
        <span>${ev.text}</span>
      </div>
    `).join("")}
  `;

  overlay.classList.add("open");
  panel.querySelector(".detail-back")!.addEventListener("click", closeDetail);

  // Click on current goal to navigate
  const goalLink = panel.querySelector(".agent-current-goal");
  if (goalLink) {
    goalLink.addEventListener("click", () => {
      const goalId = (goalLink as HTMLElement).dataset.goal;
      if (goalId) { closeDetail(); setTimeout(() => openGoalDetail(goalId), 200); }
    });
  }

  // Partner agent clicks + goal history clicks
  panel.querySelectorAll(".agent-roster-item").forEach(el => {
    el.addEventListener("click", () => {
      const aid = (el as HTMLElement).dataset.agent;
      if (aid) { closeDetail(); setTimeout(() => openAgentDetail(aid), 200); }
    });
  });
  panel.querySelectorAll(".interconnect-link").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const gid = (el as HTMLElement).dataset.goal;
      if (gid) { closeDetail(); setTimeout(() => openGoalDetail(gid), 200); }
    });
  });
}

function stringToColor(str: string): string {
  const colors = ["#5b5fc7", "#2da44e", "#d4811e", "#0969da", "#cf222e", "#8250df", "#0a7b83", "#b35900"];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// ── Goal Detail Panel ─────────────────────────────────

function openGoalDetail(goalId: string): void {
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return;

  const overlay = document.getElementById("detail-overlay")!;
  const panel = document.getElementById("detail-panel")!;
  const badgeClass = `badge-${goal.status}`;

  // Collect unique agents for this goal
  const goalAgents = goal.steps.filter(s => s.agent).map(s => s.agent!);
  const uniqueAgents = [...new Set(goalAgents)];

  panel.innerHTML = `
    <div class="detail-back">\u2190 Back</div>
    <div class="detail-status-badge ${badgeClass}">${goal.status}</div>
    <div class="detail-title">${goal.title}</div>
    <div class="detail-summary">${goal.summary}</div>

    <div class="detail-meta">
      <div class="detail-meta-item">
        <span class="detail-meta-label">Progress</span>
        <span class="detail-meta-value">${Math.round(goal.progress)}%</span>
      </div>
      <div class="detail-meta-item">
        <span class="detail-meta-label">Agents</span>
        <span class="detail-meta-value">${goal.agentCount}</span>
      </div>
      <div class="detail-meta-item">
        <span class="detail-meta-label">Steps</span>
        <span class="detail-meta-value">${goal.steps.filter(s => s.state === "done").length}/${goal.steps.length}</span>
      </div>
      <div class="detail-meta-item">
        <span class="detail-meta-label">Cost</span>
        <span class="detail-meta-value">$${goal.costUsd.toFixed(2)}</span>
      </div>
      <div class="detail-meta-item">
        <span class="detail-meta-label">Tokens</span>
        <span class="detail-meta-value">${formatTokens(goal.inputTokens + goal.outputTokens)}</span>
      </div>
      <div class="detail-meta-item">
        <span class="detail-meta-label">Duration</span>
        <span class="detail-meta-value">${formatDuration(goal.startedAt, goal.completedAt)}</span>
      </div>
    </div>

    ${uniqueAgents.length > 0 ? `
      <div class="detail-section-title">Agents</div>
      <div class="agent-roster">
        ${uniqueAgents.map(name => {
          const ag = agents.find(x => x.name === name);
          return `<div class="agent-roster-item" data-agent="${ag?.id || ""}">
            <div class="agent-avatar-sm" style="background: ${stringToColor(name)}">${name.charAt(0).toUpperCase()}</div>
            <span>${name}</span>
          </div>`;
        }).join("")}
      </div>
    ` : ""}

    <div class="detail-section-title">Steps</div>
    ${goal.steps.map(step => `
      <div class="step">
        <div class="step-line">
          <div class="step-dot ${step.state}"></div>
          <div class="step-connector"></div>
        </div>
        <div class="step-content">
          <div class="step-name">${step.name}</div>
          <div class="step-meta">
            ${step.agent ? `<span class="step-agent-link" data-agent-name="${step.agent}">${step.agent}</span>` : ""}${step.detail ? ` \u00b7 ${step.detail}` : ""}${step.time ? ` \u00b7 ${relativeTime(step.time)}` : ""}
          </div>
        </div>
      </div>
    `).join("")}

    ${/* Dependencies */""}
    ${goal.blockedBy.length > 0 || goal.enables.length > 0 ? `
      <div class="detail-section-title">Dependencies</div>
      <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px;">
        ${goal.blockedBy.map(id => {
          const dep = goals.find(g => g.id === id);
          return dep ? `<div class="interconnect-link" data-goal="${id}" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--bg-surface); border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; border: 1px solid var(--border);">
            <span style="color: var(--amber); font-size: 11px; font-weight: 600;">BLOCKED BY</span>
            <span class="goal-indicator ind-${dep.status}" style="margin: 0;"></span>
            <span style="font-weight: 500;">${dep.title}</span>
            <span style="margin-left: auto; color: var(--text-muted); font-size: 12px;">${Math.round(dep.progress)}%</span>
          </div>` : "";
        }).join("")}
        ${goal.enables.map(id => {
          const dep = goals.find(g => g.id === id);
          return dep ? `<div class="interconnect-link" data-goal="${id}" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--bg-surface); border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; border: 1px solid var(--border);">
            <span style="color: var(--green); font-size: 11px; font-weight: 600;">ENABLES</span>
            <span class="goal-indicator ind-${dep.status}" style="margin: 0;"></span>
            <span style="font-weight: 500;">${dep.title}</span>
            <span style="margin-left: auto; color: var(--text-muted); font-size: 12px;">${Math.round(dep.progress)}%</span>
          </div>` : "";
        }).join("")}
      </div>
    ` : ""}

    ${/* Shared Context / Insights */""}
    ${goal.insights.length > 0 ? `
      <div class="detail-section-title">Insights from other goals</div>
      <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;">
        ${goal.insights.map(ins => {
          const fromGoal = goals.find(g => g.id === ins.fromGoalId);
          return `<div class="insight-card" style="padding: 10px 14px; background: ${ins.relevance === "high" ? "var(--blue-soft)" : "var(--bg-surface)"}; border: 1px solid ${ins.relevance === "high" ? "var(--blue)" : "var(--border)"}; border-radius: var(--radius-sm);">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
              <span style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; color: ${ins.relevance === "high" ? "var(--blue)" : "var(--text-muted)"};">${ins.relevance} relevance</span>
              <span style="font-size: 11px; color: var(--text-muted);">\u00b7 ${relativeTime(ins.time)}</span>
              ${fromGoal ? `<span class="interconnect-link" data-goal="${fromGoal.id}" style="font-size: 11px; color: var(--accent); cursor: pointer; margin-left: auto;">from: ${fromGoal.title}</span>` : ""}
            </div>
            <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.5;">${ins.text}</div>
          </div>`;
        }).join("")}
      </div>
    ` : ""}

    ${/* Impact Areas */""}
    ${goal.areasAffected.length > 0 ? (() => {
      const relatedGoals = goals.filter(g => g.id !== goal.id && g.areasAffected.some(a => goal.areasAffected.includes(a)));
      return `
        <div class="detail-section-title">Impact areas</div>
        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: ${relatedGoals.length > 0 ? "8px" : "16px"};">
          ${goal.areasAffected.map(a => `<span class="agent-cap-tag">${a}</span>`).join("")}
        </div>
        ${relatedGoals.length > 0 ? `
          <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 16px;">
            ${relatedGoals.map(rg => {
              const shared = rg.areasAffected.filter(a => goal.areasAffected.includes(a));
              return `<div class="interconnect-link" data-goal="${rg.id}" style="display: flex; align-items: center; gap: 8px; padding: 6px 12px; font-size: 12px; color: var(--text-secondary); cursor: pointer; border-radius: var(--radius-xs); transition: background 0.12s;">
                <span class="goal-indicator ind-${rg.status}" style="margin: 0;"></span>
                <span style="font-weight: 500; color: var(--text-primary);">${rg.title}</span>
                <span style="color: var(--text-muted);">shares: ${shared.join(", ")}</span>
              </div>`;
            }).join("")}
          </div>
        ` : ""}
      `;
    })() : ""}

    <div class="detail-section-title" style="margin-top: 8px;">Timeline</div>
    ${(() => {
      // Cross-goal activity: merge in related activity from other goals
      const relatedGoalIds = [...goal.blockedBy, ...goal.enables, ...goal.insights.map(i => i.fromGoalId)];
      const relatedGoals = goals.filter(g => relatedGoalIds.includes(g.id));
      const crossActivity = relatedGoals.flatMap(rg =>
        rg.timeline.filter(ev => ev.time >= goal.startedAt).map(ev => ({
          ...ev,
          text: `<span style="opacity: 0.6; font-size: 12px;">[${rg.title}]</span> ${ev.text}`,
          cross: true,
        }))
      );
      const merged = [...goal.timeline.map(ev => ({ ...ev, cross: false })), ...crossActivity]
        .sort((a, b) => b.time - a.time);
      return merged.map(ev => `
        <div class="detail-timeline-item" style="${ev.cross ? "opacity: 0.55; border-left: 2px solid var(--border); padding-left: 10px; margin-left: -2px;" : ""}">
          <span class="detail-timeline-time">${relativeTime(ev.time)}</span>
          <span>${ev.text}</span>
        </div>
      `).join("");
    })()}
  `;

  overlay.classList.add("open");
  panel.querySelector(".detail-back")!.addEventListener("click", closeDetail);

  // Agent clicks
  panel.querySelectorAll(".agent-roster-item, .step-agent-link").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const agentName = (el as HTMLElement).dataset.agentName || "";
      const agentId = (el as HTMLElement).dataset.agent || "";
      const aid = agentId || agents.find(a => a.name === agentName)?.id;
      if (aid) { closeDetail(); setTimeout(() => openAgentDetail(aid), 200); }
    });
  });

  // Interconnect goal links
  panel.querySelectorAll(".interconnect-link").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const gid = (el as HTMLElement).dataset.goal;
      if (gid) { closeDetail(); setTimeout(() => openGoalDetail(gid), 200); }
    });
  });
}

function closeDetail(): void {
  document.getElementById("detail-overlay")!.classList.remove("open");
}

// ── Graph View (DAG Visualization) ────────────────────

function renderGraph(): void {
  const feed = document.getElementById("feed")!;

  // Build a simple DAG layout
  const nodeW = 180;
  const nodeH = 48;
  const gapX = 60;
  const gapY = 24;
  const padX = 40;
  const padY = 40;

  interface GNode {
    id: string;
    label: string;
    type: "goal" | "agent";
    status?: string;
    col: number;
    row: number;
    x: number;
    y: number;
    color: string;
  }

  interface GEdge { from: string; to: string; }

  const nodes: GNode[] = [];
  const edges: GEdge[] = [];

  // Active/blocked goals in the left column, their agents to the right
  const activeGoals = goals.filter(g => g.status !== "complete");

  activeGoals.forEach((goal, gi) => {
    const goalNode: GNode = {
      id: goal.id, label: goal.title, type: "goal", status: goal.status,
      col: 0, row: gi, x: padX, y: padY + gi * (nodeH + gapY + 60),
      color: goal.status === "blocked" ? "var(--amber)" : "var(--blue)",
    };
    nodes.push(goalNode);

    const goalAgentNames = [...new Set(goal.steps.filter(s => s.agent && (s.state === "running" || s.state === "warn")).map(s => s.agent!))];

    goalAgentNames.forEach((aName) => {
      const existingNode = nodes.find(n => n.id === `agent-${aName}`);
      if (existingNode) {
        edges.push({ from: goal.id, to: existingNode.id });
      } else {
        const agentNode: GNode = {
          id: `agent-${aName}`, label: aName, type: "agent",
          col: 1, row: nodes.filter(n => n.col === 1).length,
          x: padX + nodeW + gapX,
          y: padY + nodes.filter(n => n.col === 1).length * (nodeH + gapY),
          color: stringToColor(aName),
        };
        nodes.push(agentNode);
        edges.push({ from: goal.id, to: agentNode.id });
      }
    });
  });

  // Add dependency edges between goals
  interface GDepEdge { from: string; to: string; depType: "blocks" | "enables" | "shares-area"; }
  const depEdges: GDepEdge[] = [];
  activeGoals.forEach(goal => {
    goal.blockedBy.forEach(depId => {
      if (nodes.find(n => n.id === depId)) {
        depEdges.push({ from: depId, to: goal.id, depType: "blocks" });
      }
    });
    goal.enables.forEach(enId => {
      if (nodes.find(n => n.id === enId)) {
        depEdges.push({ from: goal.id, to: enId, depType: "enables" });
      }
    });
    // Shared area connections
    activeGoals.forEach(other => {
      if (other.id <= goal.id) return; // avoid duplicates
      const shared = other.areasAffected.filter(a => goal.areasAffected.includes(a));
      if (shared.length > 0) {
        depEdges.push({ from: goal.id, to: other.id, depType: "shares-area" });
      }
    });
  });

  // Reposition agent nodes to center vertically
  const agentNodes = nodes.filter(n => n.col === 1);
  const totalAgentHeight = agentNodes.length * (nodeH + gapY) - gapY;
  const totalGoalHeight = activeGoals.length * (nodeH + gapY + 60) - gapY;
  const agentStartY = padY + Math.max(0, (totalGoalHeight - totalAgentHeight) / 2);
  agentNodes.forEach((n, i) => { n.y = agentStartY + i * (nodeH + gapY); });

  const svgW = padX * 2 + nodeW * 2 + gapX;
  const svgH = Math.max(totalGoalHeight, totalAgentHeight) + padY * 2;

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  feed.innerHTML = `
    <svg class="graph-svg" viewBox="0 0 ${svgW} ${svgH}" width="100%" style="max-height: calc(100vh - 160px);">
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="var(--border-lit)" />
        </marker>
      </defs>

      ${/* Goal-to-agent edges */""}
      ${edges.map(e => {
        const from = nodeMap.get(e.from)!;
        const to = nodeMap.get(e.to)!;
        const x1 = from.x + nodeW;
        const y1 = from.y + nodeH / 2;
        const x2 = to.x;
        const y2 = to.y + nodeH / 2;
        const cx1 = x1 + gapX * 0.4;
        const cx2 = x2 - gapX * 0.4;
        return `<path d="M${x1},${y1} C${cx1},${y1} ${cx2},${y2} ${x2},${y2}"
          fill="none" stroke="var(--border-lit)" stroke-width="1.5" marker-end="url(#arrowhead)"
          class="graph-edge" />`;
      }).join("")}

      ${/* Goal-to-goal dependency edges */""}
      ${depEdges.map(e => {
        const from = nodeMap.get(e.from);
        const to = nodeMap.get(e.to);
        if (!from || !to) return "";
        const x1 = from.x + nodeW / 2;
        const y1 = e.depType === "shares-area" ? from.y + nodeH : from.y + nodeH;
        const x2 = to.x + nodeW / 2;
        const y2 = to.y;
        const color = e.depType === "blocks" ? "var(--amber)" : e.depType === "enables" ? "var(--green)" : "var(--border-lit)";
        const dash = e.depType === "shares-area" ? "4,4" : "none";
        const midY = (y1 + y2) / 2;
        return `<path d="M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}"
          fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="${dash}"
          opacity="0.7" marker-end="url(#arrowhead)" />`;
      }).join("")}

      ${nodes.map(n => `
        <g class="graph-node" data-id="${n.id}" style="cursor: pointer;">
          <rect x="${n.x}" y="${n.y}" width="${nodeW}" height="${nodeH}" rx="8"
            fill="var(--bg-base)" stroke="${n.color}" stroke-width="${n.type === "goal" ? 2 : 1.5}" />
          <circle cx="${n.x + 14}" cy="${n.y + nodeH / 2}" r="4" fill="${n.color}"
            ${n.type === "agent" || (n.status === "active") ? 'class="graph-pulse"' : ""} />
          <text x="${n.x + 26}" y="${n.y + nodeH / 2 + 4}" font-size="12" fill="var(--text-primary)"
            font-family="var(--font-sans)" font-weight="${n.type === "goal" ? "600" : "400"}">
            ${n.label.length > 20 ? n.label.slice(0, 20) + "\u2026" : n.label}
          </text>
        </g>
      `).join("")}
    </svg>
  `;

  // Click handlers
  feed.querySelectorAll(".graph-node").forEach(el => {
    el.addEventListener("click", () => {
      const id = (el as HTMLElement).dataset.id!;
      if (id.startsWith("agent-")) {
        const agentName = id.replace("agent-", "");
        const agent = agents.find(a => a.name === agentName);
        if (agent) openAgentDetail(agent.id);
      } else {
        openGoalDetail(id);
      }
    });
  });
}

// ── Agents View ───────────────────────────────────────

function renderAgents(): void {
  const feed = document.getElementById("feed")!;

  const working = agents.filter(a => a.status === "working");
  const idle = agents.filter(a => a.status === "idle");

  feed.innerHTML = `
    ${working.length ? `<div class="agents-section-label">Working (${working.length})</div>` : ""}
    ${working.map(a => renderAgentCard(a)).join("")}
    ${idle.length ? `<div class="agents-section-label">Idle (${idle.length})</div>` : ""}
    ${idle.map(a => renderAgentCard(a)).join("")}
  `;

  feed.querySelectorAll(".agent-card").forEach(el => {
    el.addEventListener("click", () => {
      openAgentDetail((el as HTMLElement).dataset.agent!);
    });
  });
}

function renderAgentCard(a: Agent): string {
  const statusColor = a.status === "working" ? "var(--blue)" : "var(--green)";
  return `
    <div class="agent-card" data-agent="${a.id}">
      <div class="agent-card-top">
        <div class="agent-avatar-sm" style="background: ${stringToColor(a.name)}">${a.name.charAt(0).toUpperCase()}</div>
        <div class="agent-card-info">
          <div class="agent-card-name">${a.name}</div>
          <div class="agent-card-status">
            <span class="agent-status-dot" style="background: ${statusColor}"></span>
            ${a.status}${a.currentStep ? ` \u2014 ${a.currentStep}` : ""}
          </div>
        </div>
        <div class="agent-card-stats">
          <span>${a.tasksCompleted} tasks</span>
          <span>${a.costToday}</span>
        </div>
      </div>
      <div class="agent-card-caps">
        ${a.capabilities.slice(0, 3).map(c => `<span class="agent-cap-tag">${c}</span>`).join("")}
        ${a.capabilities.length > 3 ? `<span class="agent-cap-tag">+${a.capabilities.length - 3}</span>` : ""}
      </div>
    </div>
  `;
}

// ── Costs View ────────────────────────────────────────

function getTotalCost(): number {
  return goals.reduce((sum, g) => sum + g.costUsd, 0);
}

function getTotalTokens(): { input: number; output: number } {
  return goals.reduce((acc, g) => ({
    input: acc.input + g.inputTokens,
    output: acc.output + g.outputTokens,
  }), { input: 0, output: 0 });
}

function renderCosts(): void {
  const feed = document.getElementById("feed")!;
  const totalCost = getTotalCost();
  const tokens = getTotalTokens();
  const totalTokens = tokens.input + tokens.output;
  const activeGoals = goals.filter(g => g.status === "active");
  const completedGoals = goals.filter(g => g.status === "complete");
  const sortedGoals = [...goals].sort((a, b) => b.costUsd - a.costUsd);
  const maxGoalCost = sortedGoals[0]?.costUsd || 1;

  // Efficiency metrics
  const completedSteps = goals.reduce((sum, g) => sum + g.steps.filter(s => s.state === "done").length, 0);
  const totalSteps = goals.reduce((sum, g) => sum + g.steps.length, 0);
  const costPerStep = completedSteps > 0 ? totalCost / completedSteps : 0;
  const costPerGoalCompleted = completedGoals.length > 0 ? completedGoals.reduce((s, g) => s + g.costUsd, 0) / completedGoals.length : 0;
  const avgDuration = completedGoals.length > 0 ? completedGoals.reduce((s, g) => s + ((g.completedAt || Date.now()) - g.startedAt), 0) / completedGoals.length : 0;

  // Agent cost breakdown
  const agentCosts: Record<string, { cost: number; tokens: number; goals: number }> = {};
  goals.forEach(g => {
    const agentNames = [...new Set(g.steps.filter(s => s.agent).map(s => s.agent!))];
    const perAgentCost = agentNames.length > 0 ? g.costUsd / agentNames.length : 0;
    const perAgentTokens = agentNames.length > 0 ? (g.inputTokens + g.outputTokens) / agentNames.length : 0;
    agentNames.forEach(name => {
      if (!agentCosts[name]) agentCosts[name] = { cost: 0, tokens: 0, goals: 0 };
      agentCosts[name].cost += perAgentCost;
      agentCosts[name].tokens += perAgentTokens;
      agentCosts[name].goals += 1;
    });
  });
  const sortedAgentCosts = Object.entries(agentCosts).sort(([, a], [, b]) => b.cost - a.cost);
  const maxAgentCost = sortedAgentCosts[0]?.[1].cost || 1;

  // Area cost breakdown
  const areaCosts: Record<string, { cost: number; goalCount: number }> = {};
  goals.forEach(g => {
    const perArea = g.areasAffected.length > 0 ? g.costUsd / g.areasAffected.length : 0;
    g.areasAffected.forEach(area => {
      if (!areaCosts[area]) areaCosts[area] = { cost: 0, goalCount: 0 };
      areaCosts[area].cost += perArea;
      areaCosts[area].goalCount += 1;
    });
  });
  const sortedAreaCosts = Object.entries(areaCosts).sort(([, a], [, b]) => b.cost - a.cost);

  // Spend timeline — build hourly spend bars from goal start times
  const now = Date.now();
  const hours = 6;
  const hourlySpend: number[] = new Array(hours).fill(0);
  goals.forEach(g => {
    const hourIdx = Math.min(hours - 1, Math.floor((now - g.startedAt) / 3_600_000));
    if (hourIdx >= 0 && hourIdx < hours) hourlySpend[hours - 1 - hourIdx] += g.costUsd;
  });
  const maxHourly = Math.max(...hourlySpend, 0.01);

  // Run rate projection
  const hoursActive = goals.length > 0 ? Math.max(1, (now - Math.min(...goals.map(g => g.startedAt))) / 3_600_000) : 1;
  const hourlyRate = totalCost / hoursActive;
  const dailyProjection = hourlyRate * 24;
  const monthlyProjection = hourlyRate * 24 * 30;

  // Budget utilization per goal
  const budgetLimit = settings.maxBudgetUsd;

  feed.innerHTML = `
    <div class="settings-view" style="max-width: 720px;">

      <!-- Hero metrics row -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px;">
        <div class="settings-card" style="margin-bottom: 0; padding: 16px 18px;">
          <div style="font-size: 28px; font-weight: 700; letter-spacing: -1px;">$${totalCost.toFixed(2)}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Total spend</div>
        </div>
        <div class="settings-card" style="margin-bottom: 0; padding: 16px 18px;">
          <div style="font-size: 28px; font-weight: 700; letter-spacing: -1px;">${formatTokens(totalTokens)}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Tokens used</div>
        </div>
        <div class="settings-card" style="margin-bottom: 0; padding: 16px 18px;">
          <div style="font-size: 28px; font-weight: 700; letter-spacing: -1px; color: ${hourlyRate > 5 ? "var(--amber)" : "var(--text-primary)"};">$${hourlyRate.toFixed(2)}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Per hour</div>
        </div>
        <div class="settings-card" style="margin-bottom: 0; padding: 16px 18px;">
          <div style="font-size: 28px; font-weight: 700; letter-spacing: -1px;">${goals.length}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Goals</div>
        </div>
      </div>

      <!-- Spend over time (bar chart) -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Spend over time</div>
          <div class="settings-card-desc">Last ${hours} hours</div>
        </div>
        <div style="display: flex; align-items: flex-end; gap: 4px; height: 80px; padding-top: 8px;">
          ${hourlySpend.map((val, i) => `
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%;">
              <div style="flex: 1; width: 100%; display: flex; align-items: flex-end;">
                <div style="width: 100%; height: ${Math.max(2, (val / maxHourly) * 100)}%; background: var(--accent); border-radius: 3px 3px 0 0; transition: height 0.3s; min-height: 2px;"></div>
              </div>
              <div style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">${i === hours - 1 ? "now" : `-${hours - 1 - i}h`}</div>
            </div>
          `).join("")}
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--bg-surface);">
          <span>Peak: $${maxHourly.toFixed(2)}/hr</span>
          <span>Avg: $${(totalCost / hours).toFixed(2)}/hr</span>
        </div>
      </div>

      <!-- Projections -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Projections</div>
          <div class="settings-card-desc">At current run rate of $${hourlyRate.toFixed(2)}/hr</div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
          <div>
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px;">Today</div>
            <div style="font-size: 20px; font-weight: 700;">$${dailyProjection.toFixed(0)}</div>
          </div>
          <div>
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px;">This week</div>
            <div style="font-size: 20px; font-weight: 700;">$${(dailyProjection * 7).toFixed(0)}</div>
          </div>
          <div>
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px;">This month</div>
            <div style="font-size: 20px; font-weight: 700; color: ${monthlyProjection > 500 ? "var(--amber)" : "var(--text-primary)"};">$${monthlyProjection.toFixed(0)}</div>
          </div>
        </div>
      </div>

      <!-- Efficiency metrics -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Efficiency</div>
          <div class="settings-card-desc">${completedSteps}/${totalSteps} steps completed across ${goals.length} goals</div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
          <div style="padding: 12px; background: var(--bg-surface); border-radius: var(--radius-sm);">
            <div style="font-size: 18px; font-weight: 700;">$${costPerStep.toFixed(2)}</div>
            <div style="font-size: 12px; color: var(--text-muted);">Cost per step</div>
          </div>
          <div style="padding: 12px; background: var(--bg-surface); border-radius: var(--radius-sm);">
            <div style="font-size: 18px; font-weight: 700;">$${costPerGoalCompleted.toFixed(2)}</div>
            <div style="font-size: 12px; color: var(--text-muted);">Cost per completed goal</div>
          </div>
          <div style="padding: 12px; background: var(--bg-surface); border-radius: var(--radius-sm);">
            <div style="font-size: 18px; font-weight: 700;">${totalTokens > 0 ? "$" + (totalCost / (totalTokens / 1000)).toFixed(4) : "—"}</div>
            <div style="font-size: 12px; color: var(--text-muted);">Cost per 1K tokens</div>
          </div>
          <div style="padding: 12px; background: var(--bg-surface); border-radius: var(--radius-sm);">
            <div style="font-size: 18px; font-weight: 700;">${avgDuration > 0 ? formatDuration(0, avgDuration) : "—"}</div>
            <div style="font-size: 12px; color: var(--text-muted);">Avg goal duration</div>
          </div>
        </div>
      </div>

      <!-- Token breakdown -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Token breakdown</div>
          <div class="settings-card-desc">${formatTokens(tokens.input)} input \u00b7 ${formatTokens(tokens.output)} output \u00b7 ${totalTokens > 0 ? Math.round((tokens.output / totalTokens) * 100) : 0}% output-heavy</div>
        </div>
        <div style="display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: var(--bg-surface);">
          <div style="width: ${totalTokens > 0 ? (tokens.input / totalTokens) * 100 : 50}%; background: var(--blue); transition: width 0.3s;"></div>
          <div style="width: ${totalTokens > 0 ? (tokens.output / totalTokens) * 100 : 50}%; background: var(--accent); transition: width 0.3s;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 10px; font-size: 12px;">
          <div>
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--blue); margin-right: 4px;"></span>
            <span style="color: var(--text-secondary);">Input</span>
            <span style="color: var(--text-muted); margin-left: 4px;">${formatTokens(tokens.input)}</span>
            <span style="color: var(--text-muted); font-family: var(--font-mono);"> (~$${((tokens.input / 1_000_000) * 3).toFixed(2)})</span>
          </div>
          <div>
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-right: 4px;"></span>
            <span style="color: var(--text-secondary);">Output</span>
            <span style="color: var(--text-muted); margin-left: 4px;">${formatTokens(tokens.output)}</span>
            <span style="color: var(--text-muted); font-family: var(--font-mono);"> (~$${((tokens.output / 1_000_000) * 15).toFixed(2)})</span>
          </div>
        </div>
      </div>

      <!-- Cost by agent -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Cost by agent</div>
          <div class="settings-card-desc">${sortedAgentCosts.length} agents with spend</div>
        </div>
        ${sortedAgentCosts.slice(0, 8).map(([name, data]) => `
          <div style="padding: 8px 0; border-top: 1px solid var(--bg-surface);">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <div class="agent-avatar-sm" style="background: ${stringToColor(name)}; width: 22px; height: 22px; font-size: 10px;">${name.charAt(0).toUpperCase()}</div>
              <span style="font-size: 13px; font-weight: 500; flex: 1;">${name}</span>
              <span style="font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary);">${data.goals} goal${data.goals > 1 ? "s" : ""}</span>
              <span style="font-family: var(--font-mono); font-size: 13px; font-weight: 600; width: 60px; text-align: right;">$${data.cost.toFixed(2)}</span>
            </div>
            <div style="height: 3px; background: var(--bg-surface); border-radius: 2px; overflow: hidden; margin-left: 30px;">
              <div style="width: ${(data.cost / maxAgentCost) * 100}%; height: 100%; background: ${stringToColor(name)}; border-radius: 2px; opacity: 0.7;"></div>
            </div>
          </div>
        `).join("")}
      </div>

      <!-- Cost by area -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Cost by area</div>
          <div class="settings-card-desc">Where the money goes</div>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${sortedAreaCosts.map(([area, data]) => {
            const pct = totalCost > 0 ? (data.cost / totalCost) * 100 : 0;
            return `<div style="padding: 8px 14px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 90px;">
              <span style="font-size: 12px; font-weight: 500;">${area}</span>
              <span style="font-family: var(--font-mono); font-size: 14px; font-weight: 700;">$${data.cost.toFixed(2)}</span>
              <span style="font-size: 10px; color: var(--text-muted);">${pct.toFixed(0)}% \u00b7 ${data.goalCount} goal${data.goalCount > 1 ? "s" : ""}</span>
            </div>`;
          }).join("")}
        </div>
      </div>

      <!-- Per-goal breakdown (expandable) -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Cost by goal</div>
          <div class="settings-card-desc">${activeGoals.length} active \u00b7 ${completedGoals.length} completed</div>
        </div>
        ${sortedGoals.map(g => {
          const budgetPct = budgetLimit > 0 ? (g.costUsd / budgetLimit) * 100 : 0;
          const duration = formatDuration(g.startedAt, g.completedAt);
          const goalTokens = g.inputTokens + g.outputTokens;
          return `
            <div class="cost-goal-row" data-goal="${g.id}" style="padding: 12px 0; border-top: 1px solid var(--bg-surface); cursor: pointer;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <div class="goal-indicator ind-${g.status}" style="margin-top: 0;"></div>
                <span style="font-size: 13px; font-weight: 500; flex: 1;">${g.title}</span>
                <span style="font-family: var(--font-mono); font-size: 15px; font-weight: 700;">$${g.costUsd.toFixed(2)}</span>
              </div>
              <div style="display: flex; gap: 16px; font-size: 11px; color: var(--text-muted); margin-bottom: 6px; padding-left: 16px;">
                <span>${formatTokens(goalTokens)} tokens</span>
                <span>${duration}</span>
                <span>${g.steps.filter(s => s.state === "done").length}/${g.steps.length} steps</span>
                <span>${g.agentCount} agent${g.agentCount !== 1 ? "s" : ""}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px; padding-left: 16px;">
                <div style="flex: 1; height: 6px; background: var(--bg-surface); border-radius: 3px; overflow: hidden; position: relative;">
                  <div style="width: ${Math.min(100, (g.costUsd / maxGoalCost) * 100)}%; height: 100%; background: var(--accent); border-radius: 3px; transition: width 0.3s;"></div>
                </div>
                <span style="font-size: 10px; color: ${budgetPct > 80 ? "var(--amber)" : "var(--text-muted)"}; font-family: var(--font-mono); flex-shrink: 0;">${budgetPct.toFixed(0)}% of limit</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>

      <!-- Budget & limits -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Budget</div>
          <div class="settings-card-desc">Per-goal limit: $${budgetLimit.toFixed(2)} \u00b7 Effective total: $${(budgetLimit * goals.length).toFixed(2)}</div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px;">
          <div style="padding: 12px; background: var(--bg-surface); border-radius: var(--radius-sm);">
            <div style="font-size: 18px; font-weight: 700; color: ${totalCost > budgetLimit * goals.length * 0.8 ? "var(--amber)" : "var(--green)"};">${Math.round((totalCost / (budgetLimit * goals.length)) * 100)}%</div>
            <div style="font-size: 12px; color: var(--text-muted);">Budget used</div>
          </div>
          <div style="padding: 12px; background: var(--bg-surface); border-radius: var(--radius-sm);">
            <div style="font-size: 18px; font-weight: 700; color: var(--green);">$${Math.max(0, budgetLimit * goals.length - totalCost).toFixed(2)}</div>
            <div style="font-size: 12px; color: var(--text-muted);">Remaining</div>
          </div>
        </div>
        <div style="height: 10px; background: var(--bg-surface); border-radius: 5px; overflow: hidden; position: relative;">
          <div style="width: ${Math.min(100, (totalCost / (budgetLimit * goals.length)) * 100)}%; height: 100%; background: ${totalCost > budgetLimit * goals.length * 0.8 ? "var(--amber)" : "var(--green)"}; border-radius: 5px; transition: width 0.3s;"></div>
          ${/* Budget markers for each goal */""}
          ${goals.map((_, i) => `<div style="position: absolute; left: ${((i + 1) / goals.length) * 100}%; top: 0; bottom: 0; width: 1px; background: var(--border); opacity: 0.5;"></div>`).join("")}
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; color: var(--text-muted);">
          <span>$0</span>
          <span>$${(budgetLimit * goals.length).toFixed(2)}</span>
        </div>

        ${/* Per-goal budget utilization bars */""}
        <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--bg-surface);">
          <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; color: var(--text-muted); margin-bottom: 8px;">Per-goal budget utilization</div>
          ${goals.map(g => {
            const pct = budgetLimit > 0 ? Math.min(100, (g.costUsd / budgetLimit) * 100) : 0;
            const color = pct > 90 ? "var(--red)" : pct > 70 ? "var(--amber)" : "var(--green)";
            return `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="font-size: 11px; width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-secondary);">${g.title}</span>
              <div style="flex: 1; height: 4px; background: var(--bg-surface); border-radius: 2px; overflow: hidden;">
                <div style="width: ${pct}%; height: 100%; background: ${color}; border-radius: 2px;"></div>
              </div>
              <span style="font-size: 10px; font-family: var(--font-mono); color: ${pct > 70 ? color : "var(--text-muted)"}; width: 32px; text-align: right;">${pct.toFixed(0)}%</span>
            </div>`;
          }).join("")}
        </div>
      </div>

    </div>
  `;

  // Goal row clicks
  feed.querySelectorAll(".cost-goal-row").forEach(el => {
    el.addEventListener("click", () => openGoalDetail((el as HTMLElement).dataset.goal!));
  });
}

// ── Rendering ─────────────────────────────────────────

let currentView = "needs-you";

function renderTitleStatus(): void {
  const el = document.getElementById("titlebar-status");
  if (!el) return;
  const active = goals.filter(g => g.status === "active").length;
  const blocked = goals.filter(g => g.status === "blocked").length;
  const working = agents.filter(a => a.status === "working").length;
  const totalCost = getTotalCost();
  const parts: string[] = [];
  if (active) parts.push(`${active} active`);
  if (blocked) parts.push(`${blocked} blocked`);
  parts.push(`${working} agents working`);
  parts.push(`$${totalCost.toFixed(2)} spent`);
}

function renderSidebarGoals(): void {
  const container = document.getElementById("sidebar-goals");
  if (!container) return;

  const ringCircumference = 2 * Math.PI * 7;

  container.innerHTML = goals.map(g => {
    const offset = ringCircumference - (g.progress / 100) * ringCircumference;
    const ringClass = g.status === "blocked" ? "blocked" : g.status === "complete" ? "complete" : "";
    return `
      <div class="sidebar-goal" data-goal="${g.id}">
        <svg class="progress-ring" viewBox="0 0 20 20">
          <circle class="ring-bg" cx="10" cy="10" r="7" />
          <circle class="ring-fill ${ringClass}" cx="10" cy="10" r="7"
            stroke-dasharray="${ringCircumference}" stroke-dashoffset="${offset}" />
        </svg>
        <span class="sidebar-goal-name">${g.title}</span>
        <span class="sidebar-goal-pct">${Math.round(g.progress)}%</span>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".sidebar-goal").forEach(el => {
    el.addEventListener("click", () => openGoalDetail((el as HTMLElement).dataset.goal!));
  });
}

function renderNeedsYou(): void {
  const feed = document.getElementById("feed")!;

  if (attentionItems.length === 0) {
    feed.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">\u2713</div>
        <div class="empty-state-text">Nothing needs your attention right now.<br/>Agents are handling everything.</div>
      </div>
    `;
    return;
  }

  feed.innerHTML = attentionItems.map(item => `
    <div class="attention-card ${item.kind}" data-id="${item.id}">
      <div class="attention-label">${item.label}</div>
      <div class="attention-title">${item.title}</div>
      <div class="attention-body">${item.body}</div>
      <div class="attention-context">${item.context}</div>
      <div class="attention-actions">
        ${item.actions.map(a => `<button class="btn ${a.style}" data-action="${a.label}">${a.label}</button>`).join("")}
      </div>
    </div>
  `).join("");

  feed.querySelectorAll(".btn[data-action]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const card = (e.currentTarget as HTMLElement).closest(".attention-card") as HTMLElement;
      const action = (e.currentTarget as HTMLElement).dataset.action!;
      const title = card.querySelector(".attention-title")?.textContent || "";
      card.classList.add("dismissed");
      activityLog.unshift({ time: Date.now(), text: `<strong>you</strong> chose "${action}" on "${title}"` });
      showToast("Action taken", `You chose "${action}" on "${title}"`, "var(--accent)");
      const badge = document.getElementById("attention-count");
      if (badge) {
        const remaining = feed.querySelectorAll(".attention-card:not(.dismissed)").length - 1;
        badge.textContent = String(remaining);
        if (remaining === 0) badge.style.display = "none";
      }
    });
  });
}

function renderAllWork(): void {
  const feed = document.getElementById("feed")!;

  feed.innerHTML = goals.map(goal => `
    <div class="goal-card" data-goal="${goal.id}">
      <div class="goal-top">
        <div class="goal-indicator ind-${goal.status}"></div>
        <div class="goal-info">
          <div class="goal-name">${goal.title}</div>
          <div class="goal-summary">${goal.summary}</div>
        </div>
        <div class="goal-right">
          <div class="goal-pct">${Math.round(goal.progress)}%</div>
          <div class="goal-pct-label">complete</div>
        </div>
      </div>
      <div class="goal-bar">
        <div class="goal-bar-fill" style="width: ${goal.progress}%"></div>
      </div>
      <div class="goal-footer">
        <span class="goal-tag">${goal.status}</span>
        <span class="goal-tag">${goal.agentCount} agent${goal.agentCount !== 1 ? "s" : ""}</span>
        <span class="goal-tag">${goal.steps.filter(s => s.state === "done").length}/${goal.steps.length} steps</span>
        <span class="goal-tag">$${goal.costUsd.toFixed(2)}</span>
        ${goal.blockedBy.length > 0 ? `<span class="goal-tag" style="color: var(--amber);">${goal.blockedBy.length} dep</span>` : ""}
        ${goal.enables.length > 0 ? `<span class="goal-tag" style="color: var(--green);">\u2192 ${goal.enables.length}</span>` : ""}
        ${goal.insights.length > 0 ? `<span class="goal-tag" style="color: var(--blue);">${goal.insights.length} insight${goal.insights.length > 1 ? "s" : ""}</span>` : ""}
      </div>
    </div>
  `).join("");

  feed.querySelectorAll(".goal-card").forEach(card => {
    card.addEventListener("click", () => openGoalDetail((card as HTMLElement).dataset.goal!));
  });
}

function renderActivity(): void {
  const feed = document.getElementById("feed")!;
  feed.innerHTML = activityLog.map(ev => `
    <div class="activity-item">
      <span class="activity-time">${relativeTime(ev.time)}</span>
      <span class="activity-text">${ev.text}</span>
    </div>
  `).join("");
}

// ── View Switching ────────────────────────────────────

const viewConfig: Record<string, { title: string; subtitle: string; render: () => void }> = {
  "needs-you": { title: "Needs you", subtitle: "Things that need a human decision", render: renderNeedsYou },
  "all-work": { title: "All work", subtitle: "Every goal the system is working on", render: renderAllWork },
  "activity": { title: "Activity", subtitle: "Live stream of what agents are doing", render: renderActivity },
  "agents": { title: "Agents", subtitle: `${agents.length} agents in the mesh`, render: renderAgents },
  "graph": { title: "Graph", subtitle: "How goals and agents connect", render: renderGraph },
  "costs": { title: "Costs", subtitle: "Spend, tokens, and budget tracking", render: renderCosts },
  "settings": { title: "Settings", subtitle: "Configure Fabric preferences and API keys", render: renderSettings },
};

function switchView(view: string): void {
  currentView = view;
  const config = viewConfig[view];
  if (!config) return;

  document.getElementById("view-title")!.textContent = config.title;
  document.getElementById("view-subtitle")!.textContent = config.subtitle;
  config.render();

  document.querySelectorAll(".sidebar-item[data-view]").forEach(el => {
    el.classList.toggle("active", (el as HTMLElement).dataset.view === view);
  });
}

// ── Init ──────────────────────────────────────────────

function init(): void {
  // Apply saved theme on startup
  applyTheme(settings.theme);

  // Build interconnection data
  buildAgentReputation();

  renderTitleStatus();
  renderSidebarGoals();
  renderNeedsYou();

  // Sidebar nav
  document.querySelectorAll(".sidebar-item[data-view]").forEach(el => {
    el.addEventListener("click", () => switchView((el as HTMLElement).dataset.view!));
  });

  // Cmd+K
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); openCmdk(); }
    if (e.key === "Escape") { closeCmdk(); closeDetail(); }
    // Cmd+D for dark mode
    if ((e.metaKey || e.ctrlKey) && e.key === "d") { e.preventDefault(); toggleDarkMode(); }
  });

  document.getElementById("cmdk-overlay")!.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeCmdk();
  });

  document.getElementById("detail-overlay")!.addEventListener("click", (e) => {
    const panel = document.getElementById("detail-panel")!;
    if (!panel.contains(e.target as Node)) closeDetail();
  });

  // Cmdk input
  const cmdkInput = document.getElementById("cmdk-input") as HTMLInputElement;
  cmdkInput.addEventListener("input", () => {
    cmdkSelectedIdx = 0;
    renderCmdkResults(cmdkInput.value);
  });
  cmdkInput.addEventListener("keydown", (e) => {
    const items: CmdkAction[] = (window as any).__cmdkItems || [];
    if (e.key === "ArrowDown") { e.preventDefault(); cmdkSelectedIdx = Math.min(cmdkSelectedIdx + 1, items.length - 1); renderCmdkResults(cmdkInput.value); }
    else if (e.key === "ArrowUp") { e.preventDefault(); cmdkSelectedIdx = Math.max(cmdkSelectedIdx - 1, 0); renderCmdkResults(cmdkInput.value); }
    else if (e.key === "Enter") {
      if (items[cmdkSelectedIdx]) items[cmdkSelectedIdx].action();
      else if (cmdkInput.value.length > 2) {
        // If no match, check for smart response with action links
        const q = cmdkInput.value.toLowerCase();
        const createMatch = q.match(/^(?:create|new|add|start|make)\s+(?:goal|task)?:?\s*(.+)/);
        if (createMatch) { closeCmdk(); createGoalFromNL(createMatch[1]); }
      }
    }
  });

  // Cmdk response action clicks (goal links in smart responses)
  document.getElementById("cmdk-results")!.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("cmdk-response-action")) {
      const goalId = target.dataset.goal;
      if (goalId) { closeCmdk(); openGoalDetail(goalId); }
    }
  });

  document.querySelector(".titlebar-shortcut")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openCmdk();
  });

  // Dark mode toggle button
  document.getElementById("dark-mode-toggle")?.addEventListener("click", toggleDarkMode);

  // ── Fabric Engine Event Listener ──────────────────
  if (bridge) {
    bridge.onEvent((event: any) => {
      handleFabricEvent(event);
    });
  }

  // Live simulation (only for mock data goals)
  setInterval(simulateTick, 4000);
  setInterval(() => { if (currentView === "activity") renderActivity(); }, 15000);
}

// ── Handle Real-Time Events from Fabric Engine ────────

function handleFabricEvent(event: any): void {
  switch (event.type) {
    case "goal-created": {
      // Goal was already added in createGoalFromNL; refresh UI
      renderSidebarGoals();
      renderTitleStatus();
      if (currentView === "all-work") renderAllWork();
      break;
    }
    case "goal-updated": {
      const data = event.data;
      const existing = goals.find(g => g.id === event.goalId);
      if (existing) {
        // Merge updates from engine into local state
        existing.status = data.status;
        existing.progress = data.progress;
        existing.summary = data.summary;
        existing.agentCount = data.agentCount;
        existing.steps = data.steps;
        existing.timeline = data.timeline;
      }
      renderSidebarGoals();
      renderTitleStatus();
      if (currentView === "all-work") renderAllWork();
      break;
    }
    case "step-updated": {
      renderSidebarGoals();
      if (currentView === "all-work") renderAllWork();
      break;
    }
    case "activity": {
      activityLog.unshift(event.data);
      if (activityLog.length > 100) activityLog.pop();
      if (currentView === "activity") renderActivity();
      break;
    }
    case "toast": {
      showToast(event.data.title, event.data.body, event.data.color);
      break;
    }
    case "agent-message": {
      if (!settings.showAgentMessages) break;
      activityLog.unshift({
        time: Date.now(),
        text: `<strong>orchestrator</strong> ${event.data.text.slice(0, 120)}${event.data.text.length > 120 ? "..." : ""}`,
      });
      if (currentView === "activity") renderActivity();
      break;
    }
    case "cost-update": {
      const costGoal = goals.find(g => g.id === event.goalId);
      if (costGoal) {
        costGoal.costUsd = event.data.costUsd;
        costGoal.inputTokens = event.data.inputTokens;
        costGoal.outputTokens = event.data.outputTokens;
      }
      if (currentView === "costs") renderCosts();
      renderTitleStatus();
      break;
    }
    case "attention": {
      attentionItems.push(event.data);
      const badge = document.getElementById("attention-count");
      if (badge) {
        badge.textContent = String(attentionItems.length);
        badge.style.display = "";
      }
      if (currentView === "needs-you") renderNeedsYou();
      break;
    }
  }
}

document.addEventListener("DOMContentLoaded", init);
