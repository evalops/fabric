import type { Goal, Agent, Attention, ActivityEvent, FabricSettings, FabricBridge } from './types';

const SETTINGS_KEY = "fabric:settings:v1";

export const DEFAULT_SETTINGS: FabricSettings = {
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

export const bridge = (window as any).fabric as FabricBridge | undefined;

export const state = {
  goals: [] as Goal[],
  agents: [] as Agent[],
  attentionItems: [] as Attention[],
  activityLog: [] as ActivityEvent[],
  settings: loadSettings(),
  darkMode: false,
  currentView: "needs-you",
  simIdx: 0,
  cmdkSelectedIdx: 0,
};

// Cross-module callbacks set during init to avoid circular imports
export const callbacks = {
  switchView: (_view: string) => {},
  openGoalDetail: (_id: string) => {},
  openAgentDetail: (_id: string) => {},
  renderSidebarGoals: () => {},
  renderTitleStatus: () => {},
};

export function saveSettings(): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  applyTheme(state.settings.theme);
  if (bridge) {
    bridge.updateSettings({
      apiKey: state.settings.apiKey,
      model: state.settings.model,
      maxBudgetUsd: state.settings.maxBudgetUsd,
      maxTurns: state.settings.maxTurns,
    });
  }
}

export function applyTheme(theme: FabricSettings["theme"]): void {
  let shouldBeDark = false;
  if (theme === "dark") shouldBeDark = true;
  else if (theme === "system") shouldBeDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  state.darkMode = shouldBeDark;
  document.body.classList.toggle("dark", shouldBeDark);
  const btn = document.getElementById("dark-mode-toggle");
  if (btn) btn.textContent = shouldBeDark ? "\u2600" : "\u263e";
}

export function toggleDarkMode(): void {
  state.darkMode = !state.darkMode;
  state.settings.theme = state.darkMode ? "dark" : "light";
  saveSettings();
  document.body.classList.toggle("dark", state.darkMode);
  const btn = document.getElementById("dark-mode-toggle");
  if (btn) btn.textContent = state.darkMode ? "\u2600" : "\u263e";
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
