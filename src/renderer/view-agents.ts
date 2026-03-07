import type { Agent } from './types';
import { state } from './state';
import { stringToColor, relativeTime, formatDuration } from './utils';
import { openAgentDetail } from './detail-panels';

// ── Persistent view state ────────────────────────────

type AgentSort = "name" | "tasks" | "cost" | "success-rate";
type AgentFilter = "all" | "working" | "idle" | "failed";

const agentViewState = {
  filter: "all" as AgentFilter,
  sort: "name" as AgentSort,
  search: "",
  expandedId: null as string | null,
};

// ── Summary metrics ──────────────────────────────────

function renderAgentSummary(agents: Agent[]): string {
  const working = agents.filter(a => a.status === "working").length;
  const idle = agents.filter(a => a.status === "idle").length;
  const failed = agents.filter(a => a.status === "failed").length;
  const totalTasks = agents.reduce((s, a) => s + a.tasksCompleted, 0);
  const avgSuccess = agents.length > 0
    ? Math.round(agents.reduce((s, a) => s + a.successRate, 0) / agents.length)
    : 0;
  const totalCost = agents.reduce((s, a) => s + parseFloat(a.costToday.replace("$", "") || "0"), 0);

  return `<div class="graph-stats-bar" style="margin-bottom: 16px;">
    <div class="graph-stat"><span class="graph-stat-value" style="color:var(--blue)">${working}</span><span class="graph-stat-label">working</span></div>
    <div class="graph-stat"><span class="graph-stat-value" style="color:var(--green)">${idle}</span><span class="graph-stat-label">idle</span></div>
    ${failed > 0 ? `<div class="graph-stat"><span class="graph-stat-value" style="color:var(--red)">${failed}</span><span class="graph-stat-label">failed</span></div>` : ""}
    <div class="graph-stat-divider"></div>
    <div class="graph-stat"><span class="graph-stat-value">${totalTasks}</span><span class="graph-stat-label">total tasks</span></div>
    <div class="graph-stat"><span class="graph-stat-value">${avgSuccess}%</span><span class="graph-stat-label">avg success</span></div>
    <div class="graph-stat"><span class="graph-stat-value">$${totalCost.toFixed(2)}</span><span class="graph-stat-label">cost today</span></div>
  </div>`;
}

// ── Toolbar ──────────────────────────────────────────

function renderAgentToolbar(): string {
  const filterBtn = (key: AgentFilter, label: string) => {
    const isActive = agentViewState.filter === key;
    return `<button class="agent-filter-btn${isActive ? " active" : ""}" data-filter="${key}"
      style="padding: 4px 10px; font-size: 11px; border: 1px solid ${isActive ? "var(--accent)" : "var(--border)"};
      background: ${isActive ? "var(--accent)" : "var(--bg-surface)"};
      color: ${isActive ? "white" : "var(--text-secondary)"};
      border-radius: 12px; cursor: pointer; font-family: var(--font-sans);">${label}</button>`;
  };

  const sortBtn = (field: AgentSort, label: string) => {
    const isActive = agentViewState.sort === field;
    return `<button class="agent-sort-btn${isActive ? " active" : ""}" data-sort="${field}"
      style="padding: 3px 8px; font-size: 11px; border: 1px solid ${isActive ? "var(--accent)" : "var(--border)"};
      background: ${isActive ? "var(--accent-soft)" : "transparent"};
      color: ${isActive ? "var(--accent)" : "var(--text-muted)"};
      border-radius: var(--radius-xs); cursor: pointer; font-family: var(--font-sans);">${label}</button>`;
  };

  return `<div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; padding: 14px 16px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius);">
    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
      ${filterBtn("all", "All")}
      ${filterBtn("working", "Working")}
      ${filterBtn("idle", "Idle")}
      ${filterBtn("failed", "Failed")}
      <input type="text" id="agent-search" placeholder="Search agents..." value="${agentViewState.search}"
        style="margin-left: auto; padding: 4px 10px; font-size: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-base); color: var(--text-primary); outline: none; width: 140px;" />
    </div>
    <div style="display: flex; align-items: center; gap: 6px;">
      <span style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Sort</span>
      ${sortBtn("name", "Name")}
      ${sortBtn("tasks", "Tasks")}
      ${sortBtn("cost", "Cost")}
      ${sortBtn("success-rate", "Success Rate")}
    </div>
  </div>`;
}

// ── Agent card (enhanced) ────────────────────────────

function renderAgentCard(a: Agent, isExpanded: boolean): string {
  const statusColor = a.status === "working" ? "var(--blue)" : a.status === "failed" ? "var(--red)" : "var(--green)";
  const successColor = a.successRate >= 90 ? "var(--green)" : a.successRate >= 70 ? "var(--amber)" : "var(--red)";
  // Current goal info
  const currentGoal = a.currentGoal ? state.goals.find(g => g.id === a.currentGoal) : null;

  // Recent goal history
  const recentGoals = a.goalHistory.slice(0, 5);

  // Top partners
  const partners = a.frequentPartners.slice(0, 3);

  return `
    <div class="agent-card${isExpanded ? " agent-card-expanded" : ""}" data-agent="${a.id}" style="${isExpanded ? "border-color: var(--accent);" : ""}">
      <div class="agent-card-top">
        <div class="agent-avatar-sm" style="background: ${stringToColor(a.name)}">${a.name.charAt(0).toUpperCase()}</div>
        <div class="agent-card-info">
          <div class="agent-card-name">${a.name}</div>
          <div class="agent-card-status">
            <span class="agent-status-dot" style="background: ${statusColor}"></span>
            ${a.status}${a.currentStep ? ` \u2014 ${a.currentStep}` : ""}
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 12px; flex-shrink: 0;">
          <div style="text-align: center;">
            <div style="font-size: 14px; font-weight: 700; font-family: var(--font-mono);">${a.tasksCompleted}</div>
            <div style="font-size: 10px; color: var(--text-muted);">tasks</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 14px; font-weight: 700; font-family: var(--font-mono); color: ${successColor};">${a.successRate}%</div>
            <div style="font-size: 10px; color: var(--text-muted);">success</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 14px; font-weight: 700; font-family: var(--font-mono);">${a.costToday}</div>
            <div style="font-size: 10px; color: var(--text-muted);">cost</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 14px; font-weight: 700; font-family: var(--font-mono);">${a.avgLatency}</div>
            <div style="font-size: 10px; color: var(--text-muted);">latency</div>
          </div>
        </div>
      </div>

      <!-- Capabilities -->
      <div class="agent-card-caps" style="margin-top: 8px;">
        ${a.capabilities.map(c => `<span class="agent-cap-tag">${c}</span>`).join("")}
      </div>

      <!-- Current work -->
      ${currentGoal ? `
        <div style="margin-top: 10px; padding: 8px 12px; background: var(--bg-surface); border-radius: var(--radius-sm); border-left: 3px solid var(--blue);">
          <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px;">Currently working on</div>
          <div style="font-size: 13px; font-weight: 500;">${currentGoal.title}</div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${Math.round(currentGoal.progress)}% complete \u00b7 ${currentGoal.steps.filter(s => s.state === "done").length}/${currentGoal.steps.length} steps \u00b7 ${formatDuration(currentGoal.startedAt)}</div>
        </div>
      ` : ""}

      ${isExpanded ? `
        <!-- Expanded details -->
        <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border);">

          <!-- Success rate bar -->
          <div style="margin-bottom: 14px;">
            <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">
              <span>Success rate</span>
              <span style="color: ${successColor}; font-weight: 600;">${a.successRate}%</span>
            </div>
            <div style="height: 6px; background: var(--bg-surface); border-radius: 3px; overflow: hidden;">
              <div style="width: ${a.successRate}%; height: 100%; background: ${successColor}; border-radius: 3px;"></div>
            </div>
          </div>

          <!-- Partners -->
          ${partners.length > 0 ? `
            <div style="margin-bottom: 14px;">
              <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 6px;">Frequent partners</div>
              <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                ${partners.map(p => `
                  <div style="display: flex; align-items: center; gap: 4px; padding: 4px 8px; background: var(--bg-surface); border-radius: var(--radius-xs); border: 1px solid var(--border); font-size: 11px;">
                    <div style="width: 16px; height: 16px; border-radius: 4px; background: ${stringToColor(p.agentName)}; color: white; font-size: 8px; font-weight: 700; display: flex; align-items: center; justify-content: center;">${p.agentName.charAt(0).toUpperCase()}</div>
                    <span>${p.agentName}</span>
                    <span style="color: var(--text-muted);">\u00d7${p.count}</span>
                  </div>
                `).join("")}
              </div>
            </div>
          ` : ""}

          <!-- Recent goals -->
          ${recentGoals.length > 0 ? `
            <div>
              <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 6px;">Recent goals</div>
              ${recentGoals.map(gh => `
                <div style="display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 12px; border-bottom: 1px solid var(--bg-surface);">
                  <span style="color: var(--text-secondary); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${gh.goalTitle}</span>
                  <span style="font-size: 11px; color: var(--text-muted); padding: 1px 6px; background: var(--bg-surface); border-radius: var(--radius-xs);">${gh.role}</span>
                  <span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); flex-shrink: 0;">${relativeTime(gh.time)}</span>
                </div>
              `).join("")}
            </div>
          ` : ""}

          <!-- Recent activity -->
          ${a.history.length > 0 ? `
            <div style="margin-top: 14px;">
              <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 6px;">Activity</div>
              ${a.history.slice(0, 5).map(h => `
                <div style="display: flex; gap: 8px; padding: 4px 0; font-size: 12px; color: var(--text-secondary);">
                  <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); flex-shrink: 0; width: 48px;">${relativeTime(h.time)}</span>
                  <span>${h.text}</span>
                </div>
              `).join("")}
            </div>
          ` : ""}
        </div>
      ` : `
        <div style="margin-top: 6px; text-align: center;">
          <button class="agent-expand-btn" data-agent-id="${a.id}" style="font-size: 11px; color: var(--text-muted); background: none; border: none; cursor: pointer; padding: 2px 8px; font-family: var(--font-sans);">Show more \u25BE</button>
        </div>
      `}
    </div>
  `;
}

// ── Workload chart ───────────────────────────────────

function renderWorkloadChart(agents: Agent[]): string {
  if (agents.length === 0) return "";
  const maxTasks = Math.max(...agents.map(a => a.tasksCompleted), 1);

  return `<div class="settings-card" style="margin-bottom: 16px;">
    <div class="settings-card-header">
      <div class="settings-card-title">Workload distribution</div>
      <div class="settings-card-desc">Tasks completed per agent</div>
    </div>
    <div style="display: flex; align-items: flex-end; gap: 6px; height: 100px; padding-top: 8px;">
      ${agents.map(a => {
        const height = Math.max(4, (a.tasksCompleted / maxTasks) * 100);
        const color = stringToColor(a.name);
        return `<div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%;">
          <div style="flex: 1; width: 100%; display: flex; align-items: flex-end;">
            <div style="width: 100%; height: ${height}%; background: ${color}; border-radius: 3px 3px 0 0; opacity: 0.8; transition: height 0.3s;" title="${a.name}: ${a.tasksCompleted} tasks"></div>
          </div>
          <div style="font-size: 9px; color: var(--text-muted); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60px;">${a.name}</div>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

// ── Main render ──────────────────────────────────────

export function renderAgents(): void {
  const feed = document.getElementById("feed")!;

  // Filter
  let agents = [...state.agents];
  if (agentViewState.filter !== "all") {
    agents = agents.filter(a => a.status === agentViewState.filter);
  }
  if (agentViewState.search) {
    const q = agentViewState.search.toLowerCase();
    agents = agents.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.capabilities.some(c => c.toLowerCase().includes(q))
    );
  }

  // Sort
  agents.sort((a, b) => {
    switch (agentViewState.sort) {
      case "name": return a.name.localeCompare(b.name);
      case "tasks": return b.tasksCompleted - a.tasksCompleted;
      case "cost": return parseFloat(b.costToday.replace("$", "")) - parseFloat(a.costToday.replace("$", ""));
      case "success-rate": return b.successRate - a.successRate;
      default: return 0;
    }
  });

  const working = agents.filter(a => a.status === "working");
  const idle = agents.filter(a => a.status === "idle");
  const failed = agents.filter(a => a.status === "failed");

  feed.innerHTML = `
    ${renderAgentSummary(state.agents)}
    ${renderAgentToolbar()}
    ${renderWorkloadChart(state.agents)}

    ${agents.length === 0 ? `<div style="text-align: center; color: var(--text-muted); padding: 48px 0; font-size: 13px;">No agents match your filters</div>` : ""}

    ${working.length > 0 ? `<div class="agents-section-label">Working (${working.length})</div>` : ""}
    ${working.map(a => renderAgentCard(a, agentViewState.expandedId === a.id)).join("")}
    ${idle.length > 0 ? `<div class="agents-section-label">Idle (${idle.length})</div>` : ""}
    ${idle.map(a => renderAgentCard(a, agentViewState.expandedId === a.id)).join("")}
    ${failed.length > 0 ? `<div class="agents-section-label">Failed (${failed.length})</div>` : ""}
    ${failed.map(a => renderAgentCard(a, agentViewState.expandedId === a.id)).join("")}
  `;

  // Wire card clicks for detail
  feed.querySelectorAll(".agent-card").forEach(el => {
    el.addEventListener("click", (e) => {
      // Don't navigate if clicking expand button
      if ((e.target as HTMLElement).classList.contains("agent-expand-btn")) return;
      openAgentDetail((el as HTMLElement).dataset.agent!);
    });
  });

  // Wire expand buttons
  feed.querySelectorAll(".agent-expand-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const agentId = (btn as HTMLElement).dataset.agentId!;
      agentViewState.expandedId = agentViewState.expandedId === agentId ? null : agentId;
      renderAgents();
    });
  });

  // Wire filter buttons
  feed.querySelectorAll(".agent-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      agentViewState.filter = (btn as HTMLElement).dataset.filter as AgentFilter;
      renderAgents();
    });
  });

  // Wire sort buttons
  feed.querySelectorAll(".agent-sort-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      agentViewState.sort = (btn as HTMLElement).dataset.sort as AgentSort;
      renderAgents();
    });
  });

  // Wire search
  const searchInput = document.getElementById("agent-search") as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      agentViewState.search = searchInput.value;
      renderAgents();
    });
  }
}
