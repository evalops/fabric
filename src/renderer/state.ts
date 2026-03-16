import type { Goal, Agent, Attention, ActivityEvent, FabricSettings, FabricBridge, GoalTemplate, ChatThread } from './types';

const SETTINGS_KEY = "fabric:settings:v1";
const TEMPLATES_KEY = "fabric:templates:v1";

export const DEFAULT_SETTINGS: FabricSettings = {
  apiKey: "",
  model: "anthropic/claude-sonnet-4.6",
  provider: "openrouter",
  theme: "light",
  maxBudgetUsd: 2.00,
  maxTurns: 30,
  toastNotifications: true,
  soundNotifications: false,
  showAgentMessages: true,

  // Security
  toolAllowlist: [],
  toolBlocklist: [],
  sandboxPaths: [],
  blockedPaths: [],
  allowedDomains: [],
  humanApprovalTools: [],
  redactPatterns: [],

  // Governance
  dailySpendCapUsd: 0,
  weeklySpendCapUsd: 0,
  maxConcurrentGoals: 0,
  costApprovalThresholdUsd: 0,
  turnApprovalThreshold: 0,
  maxConsecutiveErrors: 5,

  // Access Control
  ssoProvider: "none",
  ssoEntityId: "",
  sessionTimeoutMinutes: 0,
  requireGoalConfirmation: false,
  apiIpAllowlist: [],

  // Data & Privacy
  dataRetentionDays: 0,
  piiDetection: false,
  piiAutoRedact: false,
  disableFileContentSharing: false,

  // Audit
  auditLogEnabled: false,
  auditWebhookUrl: "",
};

function loadSettings(): FabricSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

export const bridge = (window as any).fabric as FabricBridge | undefined;

function loadTemplates(): GoalTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export const state = {
  goals: [] as Goal[],
  agents: [] as Agent[],
  attentionItems: [] as Attention[],
  activityLog: [] as ActivityEvent[],
  templates: loadTemplates(),
  settings: loadSettings(),
  darkMode: false,
  currentView: "chat",
  cmdkSelectedIdx: 0,
  chatThread: {
    id: "thread-1",
    messages: [],
    isStreaming: false,
    createdAt: Date.now(),
  } as ChatThread,
  chatThreads: [] as ChatThread[],
};

export function saveTemplates(): void {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(state.templates));
}

// Cross-module callbacks set during init to avoid circular imports
export const callbacks = {
  switchView: (_view: string) => {},
  openGoalDetail: (_id: string) => {},
  openAgentDetail: (_id: string) => {},
  renderSidebarGoals: () => {},
  renderTitleStatus: () => {},
  renderChat: () => {},
  sendChatMessage: (_text: string) => {},
};

export function saveSettings(): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  applyTheme(state.settings.theme);
  if (bridge) {
    bridge.updateSettings({
      apiKey: state.settings.apiKey,
      model: state.settings.model,
      provider: "openrouter",
      maxBudgetUsd: state.settings.maxBudgetUsd,
      maxTurns: state.settings.maxTurns,
      toolAllowlist: state.settings.toolAllowlist,
      toolBlocklist: state.settings.toolBlocklist,
      sandboxPaths: state.settings.sandboxPaths,
      blockedPaths: state.settings.blockedPaths,
      allowedDomains: state.settings.allowedDomains,
      humanApprovalTools: state.settings.humanApprovalTools,
      maxConcurrentGoals: state.settings.maxConcurrentGoals,
      maxConsecutiveErrors: state.settings.maxConsecutiveErrors,
    });
  }
}

/** Suppress transition flash during theme switch (inspired by t3code) */
function suppressTransitionsWhileSwitching(fn: () => void): void {
  document.body.classList.add("no-transitions");
  fn();
  // Re-enable transitions on the next frame after styles settle
  requestAnimationFrame(() => document.body.classList.remove("no-transitions"));
}

export function applyTheme(theme: FabricSettings["theme"]): void {
  let shouldBeDark = false;
  if (theme === "dark") shouldBeDark = true;
  else if (theme === "system") shouldBeDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  state.darkMode = shouldBeDark;
  suppressTransitionsWhileSwitching(() => {
    document.body.classList.toggle("dark", shouldBeDark);
  });
  const btn = document.getElementById("dark-mode-toggle");
  if (btn) {
    const moon = btn.querySelector("#theme-icon-moon") as HTMLElement | null;
    const sun = btn.querySelector("#theme-icon-sun") as HTMLElement | null;
    if (moon) moon.style.display = shouldBeDark ? "none" : "";
    if (sun) sun.style.display = shouldBeDark ? "" : "none";
  }
}

// Listen for OS theme changes when in "system" mode
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.settings.theme === "system") applyTheme("system");
});

export function toggleDarkMode(): void {
  state.darkMode = !state.darkMode;
  state.settings.theme = state.darkMode ? "dark" : "light";
  saveSettings();
  suppressTransitionsWhileSwitching(() => {
    document.body.classList.toggle("dark", state.darkMode);
  });
  const btn = document.getElementById("dark-mode-toggle");
  if (btn) {
    const moon = btn.querySelector("#theme-icon-moon") as HTMLElement | null;
    const sun = btn.querySelector("#theme-icon-sun") as HTMLElement | null;
    if (moon) moon.style.display = state.darkMode ? "none" : "";
    if (sun) sun.style.display = state.darkMode ? "" : "none";
  }
}

export function getTotalCost(): number {
  return state.goals.reduce((sum, g) => sum + g.costUsd, 0);
}

export function getTotalTokens(): { input: number; output: number } {
  return state.goals.reduce((acc, g) => ({
    input: acc.input + g.inputTokens,
    output: acc.output + g.outputTokens,
  }), { input: 0, output: 0 });
}
