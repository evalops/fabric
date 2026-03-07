import { state, getTotalCost, callbacks } from './state';
import { relativeTime } from './utils';
import { showToast } from './toasts';
import { openGoalDetail } from './detail-panels';

export function renderTitleStatus(): void {
  const el = document.getElementById("titlebar-status");
  if (!el) return;
  const active = state.goals.filter(g => g.status === "active").length;
  const blocked = state.goals.filter(g => g.status === "blocked").length;
  const working = state.agents.filter(a => a.status === "working").length;
  const totalCost = getTotalCost();
  const parts: string[] = [];
  if (active) parts.push(`${active} active`);
  if (blocked) parts.push(`${blocked} blocked`);
  parts.push(`${working} agents working`);
  parts.push(`$${totalCost.toFixed(2)} spent`);
  el.textContent = parts.join(" \u00b7 ");
}

export function renderSidebarGoals(): void {
  const container = document.getElementById("sidebar-goals");
  if (!container) return;
  const ringCircumference = 2 * Math.PI * 7;

  container.innerHTML = state.goals.map(g => {
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

export function renderNeedsYou(): void {
  const feed = document.getElementById("feed")!;

  if (state.attentionItems.length === 0) {
    feed.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">\u2713</div>
        <div class="empty-state-text">Nothing needs your attention right now.<br/>Agents are handling everything.</div>
      </div>
    `;
    return;
  }

  feed.innerHTML = state.attentionItems.map(item => `
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
      state.activityLog.unshift({ time: Date.now(), text: `<strong>you</strong> chose "${action}" on "${title}"` });
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

export function renderAllWork(): void {
  const feed = document.getElementById("feed")!;

  feed.innerHTML = state.goals.map(goal => `
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
    card.addEventListener("click", () => callbacks.openGoalDetail((card as HTMLElement).dataset.goal!));
  });
}

export function renderActivity(): void {
  const feed = document.getElementById("feed")!;
  feed.innerHTML = state.activityLog.map(ev => `
    <div class="activity-item">
      <span class="activity-time">${relativeTime(ev.time)}</span>
      <span class="activity-text">${ev.text}</span>
    </div>
  `).join("");
}
