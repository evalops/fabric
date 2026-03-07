import { state, getTotalCost, callbacks } from './state';
import { relativeTime, formatDuration } from './utils';
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

export function renderSidebarGoals(): void {
  const container = document.getElementById("sidebar-goals");
  if (!container) return;
  const ringCircumference = 2 * Math.PI * 7;

  container.innerHTML = state.goals.map(g => {
    const offset = ringCircumference - (g.progress / 100) * ringCircumference;
    const ringClass = g.status === "blocked" ? "blocked" : g.status === "complete" ? "complete" : "";
    return `
      <div class="sidebar-goal" data-goal="${g.id}" data-status="${g.status}">
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

export function renderNeedsYou(): void {
  const feed = document.getElementById("feed")!;

  if (state.attentionItems.length === 0) {
    const working = state.agents.filter(a => a.status === "working").length;
    const activeGoals = state.goals.filter(g => g.status === "active").length;
    feed.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon" style="font-size: 48px; margin-bottom: 8px;">\u2713</div>
        <div class="empty-state-text" style="font-size: 15px; font-weight: 600; margin-bottom: 8px;">All clear</div>
        <div style="font-size: 13px; color: var(--text-muted); max-width: 320px; line-height: 1.5;">
          Nothing needs your attention right now.
          ${working > 0 ? `<strong>${working}</strong> agent${working > 1 ? "s are" : " is"} actively working on <strong>${activeGoals}</strong> goal${activeGoals > 1 ? "s" : ""}.` : "All agents are idle."}
        </div>
        <div style="margin-top: 16px; display: flex; gap: 8px;">
          <button class="empty-action-btn" data-action="all-work" style="padding: 6px 14px; font-size: 12px; background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent); border-radius: var(--radius-sm); cursor: pointer; font-family: var(--font-sans);">View all work</button>
          <button class="empty-action-btn" data-action="agents" style="padding: 6px 14px; font-size: 12px; background: var(--bg-surface); color: var(--text-secondary); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; font-family: var(--font-sans);">View agents</button>
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
        <div class="attention-context">${item.context}</div>
        <div class="attention-actions">
          ${item.actions.map(a => `<button class="btn ${a.style}" data-action="${a.label}">${a.label}</button>`).join("")}
        </div>
      </div>
    `).join("")}
  `;

  feed.querySelectorAll(".btn[data-action]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const card = (e.currentTarget as HTMLElement).closest(".attention-card") as HTMLElement;
      const action = (e.currentTarget as HTMLElement).dataset.action!;
      const itemId = card.dataset.id!;
      const title = card.querySelector(".attention-title")?.textContent || "";
      card.classList.add("dismissed");
      // Remove from state after animation
      setTimeout(() => {
        state.attentionItems = state.attentionItems.filter(i => i.id !== itemId);
        const badge = document.getElementById("attention-count");
        if (badge) {
          badge.textContent = String(state.attentionItems.length);
          if (state.attentionItems.length === 0) badge.style.display = "none";
        }
        // Re-render if all dismissed
        if (state.attentionItems.length === 0 && state.currentView === "needs-you") renderNeedsYou();
      }, 350);
      state.activityLog.unshift({ time: Date.now(), text: `<strong>you</strong> chose "${action}" on "${title}"` });
      showToast("Action taken", `You chose "${action}" on "${title}"`, "var(--accent)");
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

  // Wire search
  const searchInput = document.getElementById("work-search") as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      workState.search = searchInput.value;
      renderAllWork();
    });
  }
}

// Track which activity filter is selected
let activityFilter: "all" | "errors" | "steering" | "retries" | "system" = "all";
let activitySearchQuery = "";

export function renderActivity(): void {
  const feed = document.getElementById("feed")!;

  // Categorize events by parsing the HTML text
  const categorize = (text: string): string => {
    if (text.includes("tool error") || text.includes("failed") || text.includes("Last error")) return "errors";
    if (text.includes("steering") || text.includes("steer")) return "steering";
    if (text.includes("retry") || text.includes("retrying")) return "retries";
    return "system";
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
        return `${header}
          <div class="activity-item">
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

  // Wire search input
  const searchInput = feed.querySelector("#activity-search") as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      activitySearchQuery = searchInput.value;
      renderActivity();
    });
  }
}
