// ── Fabric Renderer Entry Point ────────────────────────
// This file wires together all modules and initializes the app.

import type { Goal, CmdkAction } from './types';
import { state, bridge, callbacks, applyTheme, toggleDarkMode, getTotalCost } from './state';
import { formatTokens } from './utils';
import { showToast } from './toasts';
import { openGoalDetail, openAgentDetail, closeDetail } from './detail-panels';
import { renderTitleStatus, renderSidebarGoals, renderNeedsYou, renderAllWork, renderActivity } from './views';
import { renderAgents } from './view-agents';
import { renderGraph } from './view-graph';
import { renderCosts } from './view-costs';
import { renderSettings } from './view-settings';
import { renderChat, sendChatMessage, stopStreaming } from './view-chat';
import { openCmdk, closeCmdk, renderCmdkResults } from './cmdk';
import { handleFabricEvent } from './event-handler';

// ── View Config ────────────────────────────────────────

const viewConfig: Record<string, { title: string; subtitle: string; render: () => void }> = {
  "chat": { title: "Chat", subtitle: "Talk to the coordinator", render: renderChat },
  "needs-you": { title: "Needs you", subtitle: "Things that need a human decision", render: renderNeedsYou },
  "all-work": { title: "All work", subtitle: "Every goal the system is working on", render: renderAllWork },
  "activity": { title: "Activity", subtitle: "Live stream of what agents are doing", render: renderActivity },
  "agents": { title: "Agents", subtitle: `${state.agents.length} agents in the mesh`, render: renderAgents },
  "graph": { title: "Graph", subtitle: "How goals and agents connect", render: renderGraph },
  "costs": { title: "Costs", subtitle: "Spend, tokens, and budget tracking", render: renderCosts },
  "settings": { title: "Settings", subtitle: "Configure Fabric preferences and API keys", render: renderSettings },
};

function switchView(view: string): void {
  // Handle goal creation via cmdk
  if (view.startsWith("__create:")) {
    createGoalFromNL(view.slice(9));
    return;
  }

  state.currentView = view;
  const config = viewConfig[view];
  if (!config) return;

  // Hide the view header for chat (it has its own layout)
  const viewHeader = document.querySelector(".view-header") as HTMLElement;
  if (viewHeader) viewHeader.style.display = view === "chat" ? "none" : "";

  document.getElementById("view-title")!.textContent = config.title;
  document.getElementById("view-subtitle")!.textContent = config.subtitle;
  config.render();

  document.querySelectorAll(".sidebar-item[data-view]").forEach(el => {
    el.classList.toggle("active", (el as HTMLElement).dataset.view === view);
  });
}

// ── Goal Creation ──────────────────────────────────────

async function createGoalFromNL(description: string): Promise<void> {
  if (bridge) {
    const result = await bridge.createGoal(description);
    if (!result.success) {
      showToast("Error", result.error || "Failed to create goal", "var(--red)");
      return;
    }
    const title = description.charAt(0).toUpperCase() + description.slice(1);
    const placeholder: Goal = {
      id: result.goalId!,
      title,
      summary: "Agents are analyzing and planning steps...",
      status: "active", progress: 0, agentCount: 0,
      steps: [],
      timeline: [{ time: Date.now(), text: `Goal created by <strong>you</strong>` }],
      costUsd: 0, inputTokens: 0, outputTokens: 0, startedAt: Date.now(),
      blockedBy: [], enables: [], insights: [], areasAffected: [],
      turnCount: 0, toolCalls: [], retryCount: 0,
    };
    state.goals.unshift(placeholder);
    state.activityLog.unshift({ time: Date.now(), text: `<strong>you</strong> created goal: "${title}"` });
    renderSidebarGoals();
    renderTitleStatus();
    switchView("all-work");
  } else {
    const newId = `g${state.goals.length + 1}`;
    const newGoal: Goal = {
      id: newId,
      title: description.charAt(0).toUpperCase() + description.slice(1),
      summary: "Just created. Agents are analyzing and planning steps...",
      status: "active", progress: 0, agentCount: 0,
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
      turnCount: 0, toolCalls: [], retryCount: 0,
    };

    state.goals.unshift(newGoal);
    state.activityLog.unshift({ time: Date.now(), text: `<strong>you</strong> created goal: "${newGoal.title}"` });
    showToast("Goal created", `"${newGoal.title}" \u2014 agents are picking it up`, "var(--accent)");

    setTimeout(() => {
      newGoal.agentCount = 1;
      newGoal.progress = 8;
      newGoal.summary = "Architect is analyzing requirements and planning steps.";
      newGoal.timeline.push({ time: Date.now(), text: "<strong>architect</strong> identified 3 sub-tasks" });
      state.activityLog.unshift({ time: Date.now(), text: `<strong>architect</strong> picked up "${newGoal.title}"` });
      renderSidebarGoals();
      if (state.currentView === "all-work") renderAllWork();
      if (state.currentView === "activity") renderActivity();
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
      state.activityLog.unshift({ time: Date.now(), text: `<strong>architect</strong> analyzed requirements for "${newGoal.title}"` });
      renderSidebarGoals();
      if (state.currentView === "all-work") renderAllWork();
      if (state.currentView === "activity") renderActivity();
    }, 8000);

    renderSidebarGoals();
    renderTitleStatus();
    switchView("all-work");
  }
}

// ── Footer ────────────────────────────────────────────

function updateFooter(): void {
  const working = state.agents.filter(a => a.status === "working").length;
  const el = (id: string) => document.getElementById(id);
  const footerAgents = el("footer-agents");
  if (footerAgents) footerAgents.textContent = `${working}/${state.agents.length} agents`;

  const footerSpend = el("footer-spend");
  if (footerSpend) footerSpend.textContent = `$${getTotalCost().toFixed(2)}`;

  const { input, output } = state.goals.reduce(
    (acc, g) => ({ input: acc.input + g.inputTokens, output: acc.output + g.outputTokens }),
    { input: 0, output: 0 }
  );
  const footerTokens = el("footer-tokens");
  if (footerTokens) footerTokens.textContent = `${formatTokens(input + output)} tok`;

  const footerModel = el("footer-model");
  if (footerModel) footerModel.textContent = state.settings.model || "sonnet-4";

  // Token budget progress bar (Cline-inspired context window indicator)
  const totalCost = getTotalCost();
  const budgetCap = state.settings.dailySpendCapUsd || state.settings.maxBudgetUsd * state.goals.length || 10;
  const budgetPct = Math.min(100, (totalCost / budgetCap) * 100);
  const barFill = el("footer-token-bar-fill");
  if (barFill) {
    barFill.style.width = `${budgetPct}%`;
    barFill.classList.toggle("warn", budgetPct > 60 && budgetPct <= 85);
    barFill.classList.toggle("danger", budgetPct > 85);
  }
  const budgetLabel = el("footer-budget-label");
  if (budgetLabel) {
    budgetLabel.textContent = `$${totalCost.toFixed(2)}/$${budgetCap.toFixed(0)}`;
  }

  const footerGoals = el("footer-goals-summary");
  if (footerGoals) {
    const active = state.goals.filter(g => g.status === "active").length;
    const total = state.goals.length;
    footerGoals.textContent = active > 0 ? `${active}/${total} active` : `${total} goals`;
  }
}

// ── Init ──────────────────────────────────────────────

function init(): void {
  // Wire callbacks first (needed by both modes)
  callbacks.switchView = switchView;
  callbacks.openGoalDetail = openGoalDetail;
  callbacks.openAgentDetail = openAgentDetail;
  callbacks.renderSidebarGoals = renderSidebarGoals;
  callbacks.renderTitleStatus = renderTitleStatus;
  callbacks.renderChat = renderChat;
  callbacks.sendChatMessage = sendChatMessage;

  // Always use real data — no demo/mock mode
  loadRealData();

  state.demoMode = false; // never use mocks

  applyTheme(state.settings.theme);
  renderTitleStatus();
  renderSidebarGoals();

  // Always open to chat
  switchView("chat");

  // Set initial footer values
  updateFooter();

  // Refresh sidebar elapsed times periodically (only when there are active goals)
  setInterval(() => {
    const hasActive = state.goals.some(g => g.status === "active");
    if (hasActive) renderSidebarGoals();
    updateFooter();
  }, 2000);

  // Sidebar nav
  document.querySelectorAll(".sidebar-item[data-view]").forEach(el => {
    el.addEventListener("click", () => switchView((el as HTMLElement).dataset.view!));
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    // Don't capture shortcuts when typing in inputs
    const tag = (e.target as HTMLElement)?.tagName;
    const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); openCmdk(); return; }
    if (e.key === "Escape") {
      if (state.chatThread.isStreaming) { stopStreaming(); return; }
      closeCmdk(); closeDetail(); dismissShortcutHelp(); return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "d") { e.preventDefault(); toggleDarkMode(); return; }

    // Number keys for quick nav (only when not typing)
    if (!isInput && !e.metaKey && !e.ctrlKey) {
      const numMap: Record<string, string> = { "1": "chat", "2": "needs-you", "3": "all-work", "4": "activity", "5": "agents", "6": "graph", "7": "costs", "8": "settings" };
      if (numMap[e.key]) { e.preventDefault(); switchView(numMap[e.key]); return; }
      if (e.key === "?") { e.preventDefault(); toggleShortcutHelp(); return; }

      // j/k navigation in list views
      if (e.key === "j" || e.key === "k") {
        const feed = document.getElementById("feed");
        if (!feed) return;
        const selector = state.currentView === "all-work" ? ".goal-card"
          : state.currentView === "agents" ? ".agent-card"
          : state.currentView === "needs-you" ? ".attention-card"
          : null;
        if (!selector) return;
        const items = feed.querySelectorAll(selector);
        if (items.length === 0) return;
        e.preventDefault();
        const current = feed.querySelector(`${selector}.kb-focused`);
        let idx = current ? Array.from(items).indexOf(current) : -1;
        if (current) current.classList.remove("kb-focused");
        idx = e.key === "j" ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
        items[idx].classList.add("kb-focused");
        items[idx].scrollIntoView({ block: "nearest", behavior: "smooth" });
      }

      // Enter to open focused item
      if (e.key === "Enter") {
        const feed = document.getElementById("feed");
        if (!feed) return;
        const focused = feed.querySelector(".kb-focused") as HTMLElement | null;
        if (focused) {
          e.preventDefault();
          focused.click();
        }
      }
    }
  });

  function toggleShortcutHelp(): void {
    const existing = document.getElementById("shortcut-help");
    if (existing) { existing.remove(); return; }
    const overlay = document.createElement("div");
    overlay.id = "shortcut-help";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1100;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);animation:overlayIn 0.15s ease;";
    overlay.innerHTML = `<div style="background:var(--bg-base);border:1px solid var(--border);border-radius:var(--radius);padding:28px 32px;max-width:420px;box-shadow:var(--shadow-lg);animation:cmdkIn 0.15s ease;">
      <div style="font-size:16px;font-weight:700;margin-bottom:16px;letter-spacing:-0.3px;">Keyboard Shortcuts</div>
      <div style="display:grid;grid-template-columns:80px 1fr;gap:10px 16px;font-size:13px;align-items:center;">
        <kbd>\u2318K</kbd><span style="color:var(--text-secondary);">Command palette</span>
        <kbd>\u2318D</kbd><span style="color:var(--text-secondary);">Toggle dark mode</span>
        <kbd>1-8</kbd><span style="color:var(--text-secondary);">Switch views (1=Chat)</span>
        <kbd>j/k</kbd><span style="color:var(--text-secondary);">Navigate list items</span>
        <kbd>Enter</kbd><span style="color:var(--text-secondary);">Open focused item</span>
        <kbd>Esc</kbd><span style="color:var(--text-secondary);">Close panel/dialog</span>
        <kbd>?</kbd><span style="color:var(--text-secondary);">This help</span>
      </div>
      <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);font-size:12px;color:var(--text-muted);">
        <strong>Command palette tips:</strong> "create: fix bug", "steer: focus on auth", "pause", "resume", "batch: a | b | c", "status"
      </div>
    </div>`;
    overlay.addEventListener("click", (ev) => { if (ev.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  function dismissShortcutHelp(): void {
    document.getElementById("shortcut-help")?.remove();
  }

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
    state.cmdkSelectedIdx = 0;
    renderCmdkResults(cmdkInput.value);
  });
  cmdkInput.addEventListener("keydown", (e) => {
    const items: CmdkAction[] = (window as any).__cmdkItems || [];
    if (e.key === "ArrowDown") { e.preventDefault(); state.cmdkSelectedIdx = Math.min(state.cmdkSelectedIdx + 1, items.length - 1); renderCmdkResults(cmdkInput.value); }
    else if (e.key === "ArrowUp") { e.preventDefault(); state.cmdkSelectedIdx = Math.max(state.cmdkSelectedIdx - 1, 0); renderCmdkResults(cmdkInput.value); }
    else if (e.key === "Enter") {
      if (items[state.cmdkSelectedIdx]) items[state.cmdkSelectedIdx].action();
      else if (cmdkInput.value.length > 2) {
        const q = cmdkInput.value.toLowerCase();
        const createMatch = q.match(/^(?:create|new|add|start|make)\s+(?:goal|task)?:?\s*(.+)/);
        if (createMatch) { closeCmdk(); createGoalFromNL(createMatch[1]); }
      }
    }
  });

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

  document.getElementById("dark-mode-toggle")?.addEventListener("click", toggleDarkMode);

  // ── Sidebar resize rail ──────────────────────────────
  initSidebarResize();

  // Fabric Engine events (real mode)
  if (bridge) {
    bridge.onEvent((event: any) => handleFabricEvent(event));
  }

  // No demo simulation — real data only
}

// ── Real Data Loading ────────────────────────────────

async function loadRealData(): Promise<void> {
  if (!bridge) return;

  try {
    // Fetch existing goals from engine
    const goals = await bridge.getGoals();
    if (goals && goals.length > 0) {
      state.goals = goals.map((g: any) => ({
        id: g.id,
        title: g.title,
        summary: g.summary || "",
        status: g.status || "active",
        progress: g.progress || 0,
        agentCount: g.agentCount || 0,
        steps: g.steps || [],
        timeline: g.timeline || [],
        costUsd: g.costUsd || 0,
        inputTokens: g.inputTokens || 0,
        outputTokens: g.outputTokens || 0,
        startedAt: g.startedAt || Date.now(),
        completedAt: g.completedAt,
        blockedBy: g.blockedBy || [],
        enables: g.enables || [],
        insights: g.insights || [],
        areasAffected: g.areasAffected || [],
        turnCount: g.turnCount || 0,
        toolCalls: g.toolCalls || [],
        outcome: g.outcome,
        retryCount: g.retryCount || 0,
        lastError: g.lastError,
        sessionId: g.sessionId,
        thinking: g.thinking || [],
        diffs: g.diffs || [],
      }));

      // Derive agents from goal step data
      deriveAgentsFromGoals();
    }

    renderSidebarGoals();
    renderTitleStatus();
    updateFooter();
    if (state.currentView === "chat") renderChat();
  } catch (err) {
    console.error("Failed to load real data:", err);
    // Show error but don't crash — user can still interact
    state.activityLog.unshift({
      time: Date.now(),
      text: `<strong>system</strong> failed to load initial data: ${(err as Error).message}`,
    });
  }
}

/**
 * Derive agent roster from goal steps and tool calls.
 * Since the engine doesn't manage a separate agent registry,
 * we infer agents from the names referenced in goal execution.
 */
function deriveAgentsFromGoals(): void {
  const agentMap = new Map<string, {
    goals: Set<string>;
    tasks: number;
    errors: number;
    totalMs: number;
    isWorking: boolean;
    currentGoal?: string;
    currentStep?: string;
    lastSeen: number;
    capabilities: Set<string>;
  }>();

  for (const goal of state.goals) {
    for (const step of goal.steps) {
      if (!step.agent) continue;
      let agent = agentMap.get(step.agent);
      if (!agent) {
        agent = { goals: new Set(), tasks: 0, errors: 0, totalMs: 0, isWorking: false, lastSeen: 0, capabilities: new Set() };
        agentMap.set(step.agent, agent);
      }
      agent.goals.add(goal.id);
      if (step.state === "done") agent.tasks++;
      if (step.state === "running") {
        agent.isWorking = true;
        agent.currentGoal = goal.title;
        agent.currentStep = step.name;
      }
      if (step.time && step.time > agent.lastSeen) agent.lastSeen = step.time;
    }

    // Note: tool calls don't carry agent attribution from the engine,
    // so we can't use them to infer per-agent capabilities here.
  }

  state.agents = Array.from(agentMap.entries()).map(([name, data]) => ({
    id: `a-${name}`,
    name,
    capabilities: Array.from(data.capabilities),
    status: data.isWorking ? "working" as const : "idle" as const,
    currentGoal: data.currentGoal,
    currentStep: data.currentStep,
    tasksCompleted: data.tasks,
    avgLatency: "--",
    costToday: "--",
    history: [],
    goalHistory: Array.from(data.goals).map(goalId => {
      const g = state.goals.find(gl => gl.id === goalId);
      return { goalId, goalTitle: g?.title || goalId, role: "agent", time: g?.startedAt || 0 };
    }),
    frequentPartners: [],
    successRate: data.tasks > 0 ? Math.round(((data.tasks - data.errors) / data.tasks) * 100) : 100,
  }));
}

// ── Sidebar Resize (inspired by t3code SidebarRail) ────
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;
const SIDEBAR_STORAGE_KEY = "fabric-sidebar-width";

function initSidebarResize(): void {
  const rail = document.getElementById("sidebar-rail");
  const app = document.querySelector(".app") as HTMLElement | null;
  if (!rail || !app) return;

  // Restore saved width
  const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
  if (saved) {
    const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Number(saved)));
    app.style.setProperty("--sidebar-width", `${w}px`);
  }

  let startX = 0;
  let startWidth = 0;
  let rafId: number | null = null;
  let pendingWidth = 0;
  let moved = false;

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const sidebar = app!.querySelector(".sidebar") as HTMLElement;
    startWidth = sidebar.getBoundingClientRect().width;
    startX = e.clientX;
    moved = false;
    pendingWidth = startWidth;
    rail!.setPointerCapture(e.pointerId);
    rail!.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function onPointerMove(e: PointerEvent): void {
    if (!rail!.classList.contains("dragging")) return;
    e.preventDefault();
    const delta = e.clientX - startX;
    if (Math.abs(delta) > 2) moved = true;
    pendingWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startWidth + delta));
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      app!.style.setProperty("--sidebar-width", `${pendingWidth}px`);
      rafId = null;
    });
  }

  function onPointerUp(e: PointerEvent): void {
    if (!rail!.classList.contains("dragging")) return;
    e.preventDefault();
    rail!.classList.remove("dragging");
    if (rail!.hasPointerCapture(e.pointerId)) {
      rail!.releasePointerCapture(e.pointerId);
    }
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (moved) {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(pendingWidth));
    }
  }

  rail.addEventListener("pointerdown", onPointerDown);
  rail.addEventListener("pointermove", onPointerMove);
  rail.addEventListener("pointerup", onPointerUp);
  rail.addEventListener("pointercancel", onPointerUp);
}

document.addEventListener("DOMContentLoaded", init);
