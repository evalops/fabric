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

const agents: Agent[] = [
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

const goals: Goal[] = [
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

    <div class="detail-section-title">Capabilities</div>
    <div class="agent-caps">
      ${agent.capabilities.map(c => `<span class="agent-cap-tag">${c}</span>`).join("")}
    </div>

    ${agent.currentGoal ? `
      <div class="detail-section-title">Currently working on</div>
      <div class="agent-current-goal" data-goal="${goals.find(g => g.title === agent.currentGoal)?.id || ""}">
        <span>${agent.currentGoal}</span>
        <span class="cmdk-item-hint">\u2192</span>
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

    <div class="detail-section-title" style="margin-top: 24px;">Timeline</div>
    ${goal.timeline.slice().reverse().map(ev => `
      <div class="detail-timeline-item">
        <span class="detail-timeline-time">${relativeTime(ev.time)}</span>
        <span>${ev.text}</span>
      </div>
    `).join("")}
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

  // Sort goals by cost descending
  const sortedGoals = [...goals].sort((a, b) => b.costUsd - a.costUsd);
  const maxCost = sortedGoals[0]?.costUsd || 1;

  feed.innerHTML = `
    <div class="settings-view">
      <!-- Summary cards -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;">
        <div class="settings-card" style="margin-bottom: 0;">
          <div style="font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">$${totalCost.toFixed(2)}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">Total spend</div>
        </div>
        <div class="settings-card" style="margin-bottom: 0;">
          <div style="font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">${formatTokens(totalTokens)}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">Total tokens</div>
        </div>
        <div class="settings-card" style="margin-bottom: 0;">
          <div style="font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">${goals.length > 0 ? "$" + (totalCost / goals.length).toFixed(2) : "$0.00"}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">Avg per goal</div>
        </div>
      </div>

      <!-- Token breakdown -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Token usage</div>
          <div class="settings-card-desc">${formatTokens(tokens.input)} input, ${formatTokens(tokens.output)} output</div>
        </div>
        <div style="display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--bg-surface);">
          <div style="width: ${totalTokens > 0 ? (tokens.input / totalTokens) * 100 : 50}%; background: var(--blue); transition: width 0.3s;"></div>
          <div style="width: ${totalTokens > 0 ? (tokens.output / totalTokens) * 100 : 50}%; background: var(--accent); transition: width 0.3s;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 12px; color: var(--text-muted);">
          <span><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--blue); margin-right: 4px;"></span>Input (~$${((tokens.input / 1_000_000) * 3).toFixed(2)})</span>
          <span><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-right: 4px;"></span>Output (~$${((tokens.output / 1_000_000) * 15).toFixed(2)})</span>
        </div>
      </div>

      <!-- Per-goal breakdown -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Cost by goal</div>
          <div class="settings-card-desc">${activeGoals.length} active, ${completedGoals.length} completed</div>
        </div>
        ${sortedGoals.map(g => `
          <div class="cost-goal-row" data-goal="${g.id}" style="padding: 10px 0; border-top: 1px solid var(--bg-surface); cursor: pointer;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <div class="goal-indicator ind-${g.status}" style="margin-top: 0;"></div>
                <span style="font-size: 13px; font-weight: 500;">${g.title}</span>
              </div>
              <span style="font-family: var(--font-mono); font-size: 13px; font-weight: 600;">$${g.costUsd.toFixed(2)}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="flex: 1; height: 4px; background: var(--bg-surface); border-radius: 2px; overflow: hidden;">
                <div style="width: ${(g.costUsd / maxCost) * 100}%; height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.3s;"></div>
              </div>
              <span style="font-size: 11px; color: var(--text-muted); flex-shrink: 0; width: 50px; text-align: right;">${formatTokens(g.inputTokens + g.outputTokens)} tok</span>
            </div>
          </div>
        `).join("")}
      </div>

      <!-- Budget -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Budget</div>
          <div class="settings-card-desc">Per-goal limit: $${settings.maxBudgetUsd.toFixed(2)}</div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px;">
          <span>Effective limit for ${goals.length} goals</span>
          <span style="font-weight: 600;">$${(settings.maxBudgetUsd * goals.length).toFixed(2)}</span>
        </div>
        <div style="height: 8px; background: var(--bg-surface); border-radius: 4px; overflow: hidden;">
          <div style="width: ${Math.min(100, (totalCost / (settings.maxBudgetUsd * goals.length)) * 100)}%; height: 100%; background: ${totalCost > settings.maxBudgetUsd * goals.length * 0.8 ? "var(--amber)" : "var(--green)"}; border-radius: 4px; transition: width 0.3s;"></div>
        </div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 6px;">${Math.round((totalCost / (settings.maxBudgetUsd * goals.length)) * 100)}% of total budget used</div>
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
