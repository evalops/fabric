import { state, getTotalCost, callbacks, bridge } from './state';
import { relativeTime, formatDuration, debounce } from './utils';
import { showToast } from './toasts';
import { openGoalDetail } from './detail-panels';
import type { Goal, GoalStatus } from './types';

// ── All Work persistent filter state ──────────────────
type SortField = "recent" | "progress" | "cost" | "turns" | "name";
type SortDir = "asc" | "desc";
const workState = {
  statusFilter: new Set<GoalStatus | "all">(["all"]),
  sort: "recent" as SortField,
  sortDir: "desc" as SortDir,
  search: "",
};

export function renderTitleStatus(): void {
  const el = document.getElementById("titlebar-status");
  if (!el) return;
  const active = state.goals.filter(g => g.status === "active").length;
  const blocked = state.goals.filter(g => g.status === "blocked").length;
  const failed = state.goals.filter(g => g.status === "failed").length;
  const working = state.agents.filter(a => a.status === "working").length;
  const totalCost = getTotalCost();
  const parts: string[] = [];
  if (active) parts.push(`${active} active`);
  if (blocked) parts.push(`${blocked} blocked`);
  if (failed) parts.push(`${failed} failed`);
  parts.push(`${working} agents`);
  parts.push(`$${totalCost.toFixed(2)}`);
  el.textContent = parts.join(" \u00b7 ");

  // Update connection indicator
  const connEl = document.getElementById("connection-indicator");
  if (connEl) {
    const connected = working > 0 || active > 0;
    connEl.classList.toggle("disconnected", !connected);
    const label = connEl.querySelector(".connection-label");
    if (label) label.textContent = connected ? "Live" : "Idle";
  }
}

// Track which sidebar groups are collapsed (persists across re-renders + localStorage)
const collapsedGroups = new Set<string>();
const _storedGroups = localStorage.getItem("fabric:collapsed-groups");
if (_storedGroups) try { JSON.parse(_storedGroups).forEach((g: string) => collapsedGroups.add(g)); } catch {}

export function renderSidebarGoals(): void {
  const container = document.getElementById("sidebar-goals");
  if (!container) return;

  const total = state.goals.length;
  const active = state.goals.filter(g => g.status === "active").length;
  const complete = state.goals.filter(g => g.status === "complete").length;
  const blocked = state.goals.filter(g => g.status === "blocked").length;
  const failed = state.goals.filter(g => g.status === "failed").length;

  // Render inline counts next to "Goals" label
  const countsEl = document.getElementById("sidebar-goal-counts");
  if (countsEl && total > 0) {
    const counts: { n: number; color: string }[] = [
      { n: active, color: "var(--blue)" },
      { n: blocked, color: "var(--amber)" },
      { n: failed, color: "var(--red)" },
      { n: complete, color: "var(--green)" },
    ];
    countsEl.innerHTML = counts.filter(c => c.n > 0).map(c =>
      `<span><span class="count-dot" style="background:${c.color}"></span>${c.n}</span>`
    ).join("");
  }

  // Render mini stats bar
  const statsEl = document.getElementById("sidebar-goal-stats");
  if (statsEl && total > 0) {
    statsEl.innerHTML = [
      { count: complete, color: "var(--green)" },
      { count: active, color: "var(--blue)" },
      { count: blocked, color: "var(--amber)" },
      { count: failed, color: "var(--red)" },
    ].filter(s => s.count > 0).map(s =>
      `<div class="sidebar-goal-stats-seg" style="width: ${(s.count / total) * 100}%; background: ${s.color};"></div>`
    ).join("");
  } else if (statsEl) {
    statsEl.innerHTML = "";
  }

  // Group goals by status, with priority ordering
  const groups: { key: string; label: string; color: string; goals: Goal[] }[] = [
    { key: "active", label: "Running", color: "var(--blue)", goals: state.goals.filter(g => g.status === "active") },
    { key: "blocked", label: "Blocked", color: "var(--amber)", goals: state.goals.filter(g => g.status === "blocked") },
    { key: "failed", label: "Failed", color: "var(--red)", goals: state.goals.filter(g => g.status === "failed") },
    { key: "complete", label: "Done", color: "var(--green)", goals: state.goals.filter(g => g.status === "complete") },
  ].filter(grp => grp.goals.length > 0);

  const ringCircumference = 2 * Math.PI * 7;

  // If only one group, skip group headers for cleanliness
  if (groups.length <= 1) {
    const goals = groups[0]?.goals ?? [];
    container.innerHTML = goals.map(g => renderGoalRow(g, ringCircumference)).join("");
  } else {
    // Auto-collapse "Done" when there are active goals
    if (active > 0 && !collapsedGroups.has("__init_done")) {
      collapsedGroups.add("complete");
      collapsedGroups.add("__init_done");
    }

    container.innerHTML = groups.map(grp => {
      const isCollapsed = collapsedGroups.has(grp.key);
      return `
        <div class="sidebar-goal-group ${isCollapsed ? "collapsed" : ""}" data-group="${grp.key}">
          <div class="sidebar-goal-group-header">
            <span class="sidebar-goal-group-chevron">&#9660;</span>
            <span class="sidebar-goal-group-dot" style="background: ${grp.color}"></span>
            ${grp.label}
            <span class="sidebar-goal-group-count">${grp.goals.length}</span>
          </div>
          <div class="sidebar-goal-group-items">
            ${grp.goals.map(g => renderGoalRow(g, ringCircumference)).join("")}
          </div>
        </div>
      `;
    }).join("");
  }

  // Wire click handlers
  container.querySelectorAll(".sidebar-goal").forEach(el => {
    el.addEventListener("click", () => openGoalDetail((el as HTMLElement).dataset.goal!));
  });

  // Wire group collapse toggles (smooth max-height animation)
  container.querySelectorAll(".sidebar-goal-group").forEach(groupEl => {
    const items = groupEl.querySelector(".sidebar-goal-group-items") as HTMLElement | null;
    if (items && !groupEl.classList.contains("collapsed")) {
      items.style.maxHeight = items.scrollHeight + "px";
    }
  });
  container.querySelectorAll(".sidebar-goal-group-header").forEach(el => {
    el.addEventListener("click", () => {
      const group = (el as HTMLElement).closest(".sidebar-goal-group") as HTMLElement;
      const items = group.querySelector(".sidebar-goal-group-items") as HTMLElement;
      const key = group.dataset.group!;
      if (collapsedGroups.has(key)) {
        collapsedGroups.delete(key);
        group.classList.remove("collapsed");
        items.style.maxHeight = items.scrollHeight + "px";
      } else {
        // Set explicit max-height first so transition works
        items.style.maxHeight = items.scrollHeight + "px";
        // Force reflow then collapse
        items.offsetHeight; // eslint-disable-line @typescript-eslint/no-unused-expressions
        collapsedGroups.add(key);
        group.classList.add("collapsed");
      }
      localStorage.setItem("fabric:collapsed-groups", JSON.stringify([...collapsedGroups]));
    });
  });
}

function sidebarRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Compact elapsed time like Codex: "2m 34s", "1h 03m" */
function formatElapsed(startTs: number): string {
  const diff = Math.max(0, Date.now() - startTs);
  const s = Math.floor(diff / 1000) % 60;
  const m = Math.floor(diff / 60_000) % 60;
  const h = Math.floor(diff / 3_600_000);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Get the current running step for a goal (used as live activity subtitle) */
function getCurrentActivity(g: Goal): string | null {
  if (g.status !== "active") return null;
  const running = g.steps.find(s => s.state === "running");
  if (running) {
    const detail = running.detail ? ` -- ${running.detail}` : "";
    return `${running.name}${detail}`;
  }
  // Fallback: show latest tool call
  if (g.toolCalls.length > 0) {
    const latest = g.toolCalls[g.toolCalls.length - 1];
    return latest.tool;
  }
  return null;
}

function renderGoalRow(g: Goal, ringCircumference: number): string {
  const offset = ringCircumference - (g.progress / 100) * ringCircumference;
  const ringClass = g.status === "blocked" ? "blocked"
    : g.status === "failed" ? "failed"
    : g.status === "complete" ? "complete" : "";

  // Right side: status badge for blocked/failed, percentage + elapsed for active, time for done
  const isActive = g.status === "active";
  const elapsed = isActive && g.startedAt ? formatElapsed(g.startedAt) : "";
  const ts = g.completedAt || g.startedAt;
  const timeStr = !isActive && ts ? sidebarRelativeTime(ts) : "";

  const rightSide = g.status === "blocked"
    ? `<span class="sidebar-goal-status status-blocked">blocked</span>`
    : g.status === "failed"
    ? `<span class="sidebar-goal-status status-failed">failed</span>`
    : `<span class="sidebar-goal-meta">
        <span class="sidebar-goal-pct">${Math.round(g.progress)}%</span>
        ${elapsed ? `<span class="sidebar-goal-time">${elapsed}</span>` : ""}
        ${timeStr ? `<span class="sidebar-goal-time">${timeStr}</span>` : ""}
      </span>`;

  // Live activity subtitle for active goals (Codex-inspired status indicator)
  const activity = getCurrentActivity(g);
  const activityLine = activity
    ? `<div class="sidebar-goal-activity">${activity}</div>`
    : "";

  return `
    <div class="sidebar-goal" data-goal="${g.id}" data-status="${g.status}">
      <svg class="progress-ring" viewBox="0 0 20 20">
        <circle class="ring-bg" cx="10" cy="10" r="7" />
        <circle class="ring-fill ${ringClass}" cx="10" cy="10" r="7"
          stroke-dasharray="${ringCircumference}" stroke-dashoffset="${offset}" />
      </svg>
      <div class="sidebar-goal-content">
        <div class="sidebar-goal-top">
          <span class="sidebar-goal-name">${g.title}</span>
          ${rightSide}
        </div>
        ${activityLine}
      </div>
    </div>
  `;
}

export function renderNeedsYou(): void {
  const feed = document.getElementById("feed")!;

  if (state.attentionItems.length === 0) {
    const working = state.agents.filter(a => a.status === "working").length;
    const activeGoals = state.goals.filter(g => g.status === "active").length;
    const totalGoals = state.goals.length;
    const completedGoals = state.goals.filter(g => g.status === "complete").length;
    const totalCost = state.goals.reduce((s, g) => s + g.costUsd, 0);

    const statusLine = working > 0
      ? `<strong>${working}</strong> agent${working > 1 ? "s" : ""} working on <strong>${activeGoals}</strong> goal${activeGoals > 1 ? "s" : ""}`
      : totalGoals > 0
        ? `${completedGoals}/${totalGoals} goals completed`
        : "No goals yet. Create one with <kbd>Cmd+K</kbd>";

    feed.innerHTML = `
      <div class="empty-state-hero">
        <div class="hero-orb">
          <div class="hero-orb-ring hero-orb-ring-1"></div>
          <div class="hero-orb-ring hero-orb-ring-2"></div>
          <div class="hero-orb-ring hero-orb-ring-3"></div>
          <div class="hero-orb-core">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          </div>
        </div>

        <div class="hero-title">All systems nominal</div>
        <div class="hero-subtitle">${statusLine}</div>

        ${totalGoals > 0 ? `
        <div class="hero-metrics">
          <div class="hero-metric">
            <div class="hero-metric-value">${totalGoals}</div>
            <div class="hero-metric-label">goals</div>
          </div>
          <div class="hero-metric-divider"></div>
          <div class="hero-metric">
            <div class="hero-metric-value">${completedGoals}</div>
            <div class="hero-metric-label">complete</div>
          </div>
          <div class="hero-metric-divider"></div>
          <div class="hero-metric">
            <div class="hero-metric-value">$${totalCost.toFixed(2)}</div>
            <div class="hero-metric-label">spent</div>
          </div>
        </div>` : ""}

        <div class="hero-actions">
          <button class="hero-btn hero-btn-primary empty-action-btn" data-action="chat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            Start a conversation
          </button>
          <button class="hero-btn empty-action-btn" data-action="all-work">View all work</button>
          <button class="hero-btn empty-action-btn" data-action="costs">Cost overview</button>
        </div>
      </div>
    `;
    feed.querySelectorAll(".empty-action-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        callbacks.switchView((btn as HTMLElement).dataset.action!);
      });
    });
    return;
  }

  // Sort by urgency: crit > warn > ask
  const urgencyOrder: Record<string, number> = { crit: 0, warn: 1, ask: 2 };
  const sorted = [...state.attentionItems].sort((a, b) => (urgencyOrder[a.kind] ?? 3) - (urgencyOrder[b.kind] ?? 3));

  const critCount = sorted.filter(i => i.kind === "crit").length;
  const warnCount = sorted.filter(i => i.kind === "warn").length;
  const askCount = sorted.filter(i => i.kind === "ask").length;

  feed.innerHTML = `
    <div class="graph-stats-bar" style="margin-bottom: 16px;">
      ${critCount > 0 ? `<div class="graph-stat"><span class="graph-stat-value" style="color:var(--red)">${critCount}</span><span class="graph-stat-label">critical</span></div>` : ""}
      ${warnCount > 0 ? `<div class="graph-stat"><span class="graph-stat-value" style="color:var(--amber)">${warnCount}</span><span class="graph-stat-label">warning</span></div>` : ""}
      ${askCount > 0 ? `<div class="graph-stat"><span class="graph-stat-value" style="color:var(--blue)">${askCount}</span><span class="graph-stat-label">decision</span></div>` : ""}
      <div class="graph-stat"><span class="graph-stat-value">${sorted.length}</span><span class="graph-stat-label">total</span></div>
    </div>

    ${sorted.map(item => `
      <div class="attention-card ${item.kind}" data-id="${item.id}">
        <div class="attention-label">${item.label}</div>
        <div class="attention-title">${item.title}</div>
        <div class="attention-body">${item.body}</div>
        ${item.context ? `<div class="attention-context">${item.context}</div>` : ""}
        <div class="attention-response-row">
          <input class="attention-input" type="text" placeholder="Type a response..." data-id="${item.id}" />
          <button class="btn btn-primary attention-send-btn" data-id="${item.id}">Send</button>
        </div>
        <div class="attention-actions">
          ${item.actions.map(a => `<button class="btn ${a.style}" data-action="${a.label}" data-id="${item.id}">${a.label}</button>`).join("")}
        </div>
      </div>
    `).join("")}
  `;

  const respondAndDismiss = (itemId: string, response: string) => {
    const card = feed.querySelector(`.attention-card[data-id="${itemId}"]`) as HTMLElement | null;
    if (card) {
      // Prevent double-submit: if already dismissed, bail out
      if (card.classList.contains("dismissed")) return;
      card.classList.add("dismissed");
      // Disable send button and action buttons immediately
      card.querySelectorAll("button").forEach(btn => (btn as HTMLButtonElement).disabled = true);
    }

    // Send response to engine via bridge
    if (bridge?.resolveAttention) {
      bridge.resolveAttention(itemId, response);
    }

    setTimeout(() => {
      state.attentionItems = state.attentionItems.filter(i => i.id !== itemId);
      const badge = document.getElementById("attention-count");
      if (badge) {
        badge.textContent = String(state.attentionItems.length);
        if (state.attentionItems.length === 0) badge.style.display = "none";
      }
      if (state.attentionItems.length === 0 && state.currentView === "needs-you") renderNeedsYou();
    }, 350);

    state.activityLog.unshift({ time: Date.now(), text: `<strong>you</strong> responded: "${response}"` });
    showToast("Response sent", `Answered: "${response.slice(0, 60)}"`, "var(--accent)");
  };

  // Quick-action buttons
  feed.querySelectorAll(".btn[data-action]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = (e.currentTarget as HTMLElement).dataset.action!;
      const itemId = (e.currentTarget as HTMLElement).dataset.id!;
      respondAndDismiss(itemId, action);
    });
  });

  // Free-text response
  feed.querySelectorAll(".attention-send-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const itemId = (btn as HTMLElement).dataset.id!;
      const input = feed.querySelector(`.attention-input[data-id="${itemId}"]`) as HTMLInputElement;
      if (input && input.value.trim()) {
        respondAndDismiss(itemId, input.value.trim());
      }
    });
  });

  // Enter key on input
  feed.querySelectorAll(".attention-input").forEach(input => {
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") {
        const el = e.currentTarget as HTMLInputElement;
        const itemId = el.dataset.id!;
        if (el.value.trim()) respondAndDismiss(itemId, el.value.trim());
      }
    });
  });
}

export function renderAllWork(): void {
  const feed = document.getElementById("feed")!;

  // Filter
  let goals = [...state.goals];
  if (!workState.statusFilter.has("all")) {
    goals = goals.filter(g => workState.statusFilter.has(g.status as GoalStatus));
  }
  if (workState.search) {
    const q = workState.search.toLowerCase();
    goals = goals.filter(g =>
      g.title.toLowerCase().includes(q) ||
      g.summary.toLowerCase().includes(q) ||
      g.areasAffected.some(a => a.toLowerCase().includes(q))
    );
  }

  // Sort
  const dir = workState.sortDir === "desc" ? -1 : 1;
  goals.sort((a, b) => {
    switch (workState.sort) {
      case "recent": return dir * (b.startedAt - a.startedAt);
      case "progress": return dir * (a.progress - b.progress);
      case "cost": return dir * (a.costUsd - b.costUsd);
      case "turns": return dir * (a.turnCount - b.turnCount);
      case "name": return dir * a.title.localeCompare(b.title);
      default: return 0;
    }
  });

  // Summary stats
  const active = state.goals.filter(g => g.status === "active").length;
  const complete = state.goals.filter(g => g.status === "complete").length;
  const blocked = state.goals.filter(g => g.status === "blocked").length;
  const failed = state.goals.filter(g => g.status === "failed").length;
  const totalCost = state.goals.reduce((s, g) => s + g.costUsd, 0);

  const statusBtn = (key: GoalStatus | "all", label: string, count: number, color?: string) => {
    const isActive = workState.statusFilter.has(key);
    return `<button class="work-filter-btn${isActive ? " active" : ""}" data-status="${key}"
      style="--btn-color: ${color || "var(--accent)"}; padding: 4px 10px; font-size: 11px; font-weight: 500;
      border: 1px solid ${isActive ? (color || "var(--accent)") : "var(--border)"};
      background: ${isActive ? `color-mix(in srgb, ${color || "var(--accent)"} 10%, transparent)` : "var(--bg-surface)"};
      color: ${isActive ? (color || "var(--accent)") : "var(--text-secondary)"};
      border-radius: 12px; cursor: pointer; white-space: nowrap; font-family: var(--font-sans);">${label}${count > 0 ? ` (${count})` : ""}</button>`;
  };

  const sortBtn = (field: SortField, label: string) => {
    const isActive = workState.sort === field;
    const arrow = isActive ? (workState.sortDir === "desc" ? " \u2193" : " \u2191") : "";
    return `<button class="work-sort-btn${isActive ? " active" : ""}" data-sort="${field}"
      style="padding: 3px 8px; font-size: 11px; border: 1px solid ${isActive ? "var(--accent)" : "var(--border)"};
      background: ${isActive ? "var(--accent-soft)" : "transparent"}; color: ${isActive ? "var(--accent)" : "var(--text-muted)"};
      border-radius: var(--radius-xs); cursor: pointer; font-family: var(--font-sans);">${label}${arrow}</button>`;
  };

  feed.innerHTML = `
    <div class="work-toolbar" style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; padding: 14px 16px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius);">
      <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
        ${statusBtn("all", "All", state.goals.length)}
        ${statusBtn("active", "Active", active, "var(--blue)")}
        ${statusBtn("complete", "Done", complete, "var(--green)")}
        ${statusBtn("blocked", "Blocked", blocked, "var(--amber)")}
        ${statusBtn("failed", "Failed", failed, "var(--red)")}
        <input type="text" id="work-search" placeholder="Search goals..." value="${workState.search}"
          style="margin-left: auto; padding: 4px 10px; font-size: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-base); color: var(--text-primary); outline: none; width: 160px;" />
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Sort</span>
        ${sortBtn("recent", "Recent")}
        ${sortBtn("progress", "Progress")}
        ${sortBtn("cost", "Cost")}
        ${sortBtn("turns", "Turns")}
        ${sortBtn("name", "Name")}
        <span style="margin-left: auto; font-size: 11px; color: var(--text-muted);">${goals.length} goal${goals.length !== 1 ? "s" : ""} \u00b7 $${totalCost.toFixed(2)} total</span>
      </div>
    </div>

    ${goals.length === 0 ? `<div style="text-align: center; color: var(--text-muted); padding: 48px 0; font-size: 13px;">No goals match your filters</div>` : ""}

    ${goals.map(goal => `
      <div class="goal-card" data-goal="${goal.id}" data-status="${goal.status}">
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
          ${goal.outcome ? `<span class="goal-tag outcome-badge outcome-${goal.outcome}" style="border: none; padding: 2px 6px;">${goal.outcome.replace(/_/g, " ")}</span>` : ""}
          <span class="goal-tag">${goal.agentCount} agent${goal.agentCount !== 1 ? "s" : ""}</span>
          <span class="goal-tag">${goal.steps.filter(s => s.state === "done").length}/${goal.steps.length} steps</span>
          <span class="goal-tag">${goal.turnCount || 0} turns</span>
          <span class="goal-tag">$${goal.costUsd.toFixed(2)}</span>
          <span class="goal-tag">${formatDuration(goal.startedAt, goal.completedAt)}</span>
          ${goal.retryCount ? `<span class="goal-tag" style="color: var(--amber);">${goal.retryCount} retries</span>` : ""}
          ${goal.blockedBy.length > 0 ? `<span class="goal-tag" style="color: var(--amber);">${goal.blockedBy.length} dep</span>` : ""}
          ${goal.enables.length > 0 ? `<span class="goal-tag" style="color: var(--green);">\u2192 ${goal.enables.length}</span>` : ""}
          ${goal.insights.length > 0 ? `<span class="goal-tag" style="color: var(--blue);">${goal.insights.length} insight${goal.insights.length > 1 ? "s" : ""}</span>` : ""}
        </div>
      </div>
    `).join("")}
  `;

  // Wire goal card clicks
  feed.querySelectorAll(".goal-card").forEach(card => {
    card.addEventListener("click", () => callbacks.openGoalDetail((card as HTMLElement).dataset.goal!));
  });

  // Wire status filter
  feed.querySelectorAll(".work-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const status = (btn as HTMLElement).dataset.status as GoalStatus | "all";
      if (status === "all") {
        workState.statusFilter.clear();
        workState.statusFilter.add("all");
      } else {
        workState.statusFilter.delete("all");
        if (workState.statusFilter.has(status)) {
          workState.statusFilter.delete(status);
          if (workState.statusFilter.size === 0) workState.statusFilter.add("all");
        } else {
          workState.statusFilter.add(status);
        }
      }
      renderAllWork();
    });
  });

  // Wire sort
  feed.querySelectorAll(".work-sort-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const field = (btn as HTMLElement).dataset.sort as SortField;
      if (workState.sort === field) {
        workState.sortDir = workState.sortDir === "desc" ? "asc" : "desc";
      } else {
        workState.sort = field;
        workState.sortDir = "desc";
      }
      renderAllWork();
    });
  });

  // Wire search (debounced)
  const searchInput = document.getElementById("work-search") as HTMLInputElement | null;
  if (searchInput) {
    const debouncedWorkSearch = debounce(() => {
      workState.search = searchInput.value;
      renderAllWork();
    }, 150);
    searchInput.addEventListener("input", debouncedWorkSearch);
  }
}

// Track which activity filter is selected
let activityFilter: "all" | "errors" | "steering" | "retries" | "system" = "all";
let activitySearchQuery = "";

export function renderActivity(): void {
  const feed = document.getElementById("feed")!;

  // Categorize events by parsing the HTML text (used for filtering + t3code-style tone colors)
  const categorize = (text: string): string => {
    if (text.includes("tool error") || text.includes("failed") || text.includes("Last error")) return "errors";
    if (text.includes("steering") || text.includes("steer")) return "steering";
    if (text.includes("retry") || text.includes("retrying")) return "retries";
    return "system";
  };

  // Map category to visual tone for left-border coloring
  const toneOf = (text: string): string => {
    const cat = categorize(text);
    if (cat === "errors") return "error";
    if (cat === "steering") return "steering";
    if (cat === "retries") return "retry";
    if (text.includes("completed") || text.includes("success") || text.includes("done")) return "success";
    if (text.includes("tool") || text.includes("called") || text.includes("invoked")) return "tool";
    return "";
  };

  const counts = { all: state.activityLog.length, errors: 0, steering: 0, retries: 0, system: 0 };
  state.activityLog.forEach(ev => { counts[categorize(ev.text) as keyof typeof counts]++; });

  let filtered = state.activityLog;
  if (activityFilter !== "all") {
    filtered = filtered.filter(ev => categorize(ev.text) === activityFilter);
  }
  if (activitySearchQuery) {
    const q = activitySearchQuery.toLowerCase();
    filtered = filtered.filter(ev => ev.text.toLowerCase().includes(q));
  }

  const filterBtn = (key: typeof activityFilter, label: string) => {
    const active = activityFilter === key;
    const count = counts[key];
    return `<button class="activity-filter-btn${active ? " active" : ""}" data-filter="${key}" style="padding: 4px 10px; font-size: 11px; border: 1px solid ${active ? "var(--accent)" : "var(--border)"}; background: ${active ? "var(--accent)" : "var(--bg-surface)"}; color: ${active ? "white" : "var(--text-secondary)"}; border-radius: 12px; cursor: pointer; white-space: nowrap;">${label}${count > 0 ? ` (${count})` : ""}</button>`;
  };

  feed.innerHTML = `
    <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 12px; flex-wrap: wrap;">
      ${filterBtn("all", "All")}
      ${filterBtn("errors", "Errors")}
      ${filterBtn("steering", "Steering")}
      ${filterBtn("retries", "Retries")}
      ${filterBtn("system", "System")}
      <input type="text" id="activity-search" placeholder="Filter..." value="${activitySearchQuery}" style="margin-left: auto; padding: 4px 10px; font-size: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-surface); color: var(--text-primary); outline: none; width: 140px;" />
    </div>
    ${filtered.length === 0 ? `<div style="text-align: center; color: var(--text-muted); padding: 32px 0; font-size: 13px;">No activity matching filter</div>` : ""}
    ${(() => {
      // Group events by time buckets
      const now = Date.now();
      const buckets = [
        { label: "Just now", maxAge: 60_000, live: true },
        { label: "Minutes ago", maxAge: 3_600_000, live: false },
        { label: "Earlier", maxAge: Infinity, live: false },
      ];
      let lastBucket = -1;
      return filtered.map(ev => {
        const age = now - ev.time;
        const bucketIdx = buckets.findIndex(b => age < b.maxAge);
        const bucket = buckets[bucketIdx] || buckets[buckets.length - 1];
        let header = "";
        if (bucketIdx !== lastBucket) {
          lastBucket = bucketIdx;
          header = `<div class="activity-time-group">
            <span class="activity-time-group-dot${bucket.live ? " live" : ""}"></span>
            ${bucket.label}
          </div>`;
        }
        const tone = toneOf(ev.text);
        return `${header}
          <div class="activity-item"${tone ? ` data-tone="${tone}"` : ""}>
            <span class="activity-time">${relativeTime(ev.time)}</span>
            <span class="activity-text">${ev.text}</span>
          </div>`;
      }).join("");
    })()}
  `;

  // Wire filter buttons
  feed.querySelectorAll(".activity-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      activityFilter = (btn as HTMLElement).dataset.filter as typeof activityFilter;
      renderActivity();
    });
  });

  // Wire search input (debounced)
  const activitySearchInput = feed.querySelector("#activity-search") as HTMLInputElement | null;
  if (activitySearchInput) {
    const debouncedActivitySearch = debounce(() => {
      activitySearchQuery = activitySearchInput.value;
      renderActivity();
    }, 150);
    activitySearchInput.addEventListener("input", debouncedActivitySearch);
  }
}
