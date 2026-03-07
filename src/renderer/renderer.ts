// ── Fabric Renderer Entry Point ────────────────────────
// This file wires together all modules and initializes the app.

import type { Goal, CmdkAction } from './types';
import { state, bridge, callbacks, applyTheme, toggleDarkMode } from './state';
import { showToast } from './toasts';
import { initMockData, simulateTick } from './mock-data';
import { openGoalDetail, openAgentDetail, closeDetail } from './detail-panels';
import { renderTitleStatus, renderSidebarGoals, renderNeedsYou, renderAllWork, renderActivity } from './views';
import { renderAgents } from './view-agents';
import { renderGraph } from './view-graph';
import { renderCosts } from './view-costs';
import { renderSettings } from './view-settings';
import { openCmdk, closeCmdk, renderCmdkResults } from './cmdk';
import { handleFabricEvent } from './event-handler';

// ── View Config ────────────────────────────────────────

const viewConfig: Record<string, { title: string; subtitle: string; render: () => void }> = {
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

// ── Init ──────────────────────────────────────────────

function init(): void {
  // Initialize mock data and wire callbacks
  initMockData();

  callbacks.switchView = switchView;
  callbacks.openGoalDetail = openGoalDetail;
  callbacks.openAgentDetail = openAgentDetail;
  callbacks.renderSidebarGoals = renderSidebarGoals;
  callbacks.renderTitleStatus = renderTitleStatus;

  applyTheme(state.settings.theme);
  renderTitleStatus();
  renderSidebarGoals();
  renderNeedsYou();

  // Sidebar nav
  document.querySelectorAll(".sidebar-item[data-view]").forEach(el => {
    el.addEventListener("click", () => switchView((el as HTMLElement).dataset.view!));
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); openCmdk(); }
    if (e.key === "Escape") { closeCmdk(); closeDetail(); }
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

  // Fabric Engine events
  if (bridge) {
    bridge.onEvent((event: any) => handleFabricEvent(event));
  }

  // Simulation
  setInterval(() => {
    simulateTick();
    if (state.currentView === "costs") renderCosts();
    if (state.currentView === "agents") renderAgents();
    if (state.currentView === "graph") renderGraph();
    if (state.currentView === "activity") renderActivity();
  }, 4000);
}

document.addEventListener("DOMContentLoaded", init);
