import { state, callbacks, saveTemplates } from './state';
import { relativeTime, stringToColor, formatTokens, formatDuration } from './utils';
import { showToast } from './toasts';
import type { Goal, ToolCallRecord } from './types';

function renderToolBreakdown(toolCalls: ToolCallRecord[]): string {
  if (toolCalls.length === 0) return "";
  const breakdown: Record<string, { count: number; totalMs: number; errors: number }> = {};
  for (const call of toolCalls) {
    if (!breakdown[call.tool]) breakdown[call.tool] = { count: 0, totalMs: 0, errors: 0 };
    breakdown[call.tool].count++;
    breakdown[call.tool].totalMs += call.durationMs;
    if (!call.success) breakdown[call.tool].errors++;
  }
  const sorted = Object.entries(breakdown).sort((a, b) => b[1].count - a[1].count);
  return `
    <div class="detail-section-title">Tool breakdown</div>
    <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 16px; font-size: 12px;">
      ${sorted.map(([tool, stats]) => `
        <div style="display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: var(--bg-surface); border-radius: var(--radius-xs); border: 1px solid var(--border);">
          <span style="font-weight: 600; min-width: 80px;">${tool}</span>
          <span style="color: var(--text-muted);">${stats.count} call${stats.count !== 1 ? "s" : ""}</span>
          <span style="color: var(--text-muted);">${Math.round(stats.totalMs / stats.count)}ms avg</span>
          ${stats.errors > 0 ? `<span style="color: var(--red); margin-left: auto;">${stats.errors} error${stats.errors !== 1 ? "s" : ""}</span>` : `<span style="color: var(--green); margin-left: auto;">ok</span>`}
        </div>
      `).join("")}
    </div>
  `;
}

function renderObservabilityMeta(goal: Goal): string {
  const parts: string[] = [];
  if (goal.turnCount > 0) {
    parts.push(`
      <div class="detail-meta-item">
        <span class="detail-meta-label">Turns</span>
        <span class="detail-meta-value">${goal.turnCount}</span>
      </div>
    `);
  }
  if (goal.outcome) {
    const outcomeColors: Record<string, string> = {
      success: "var(--green)", budget_exhausted: "var(--amber)",
      turns_exhausted: "var(--amber)", user_abort: "var(--text-muted)", error: "var(--red)",
    };
    const label = goal.outcome.replace(/_/g, " ");
    parts.push(`
      <div class="detail-meta-item">
        <span class="detail-meta-label">Outcome</span>
        <span class="detail-meta-value" style="color: ${outcomeColors[goal.outcome] || "inherit"};">${label}</span>
      </div>
    `);
  }
  if (goal.retryCount > 0) {
    parts.push(`
      <div class="detail-meta-item">
        <span class="detail-meta-label">Retries</span>
        <span class="detail-meta-value" style="color: var(--amber);">${goal.retryCount}</span>
      </div>
    `);
  }
  return parts.join("");
}

function renderSteeringInput(goalId: string): string {
  const goal = state.goals.find(g => g.id === goalId);
  if (!goal) return "";

  // Show resume button for non-active goals
  if (goal.status !== "active") {
    return `
      ${goal.lastError ? `<div style="font-size: 12px; color: var(--red); margin-bottom: 12px; padding: 8px 12px; background: var(--bg-surface); border: 1px solid var(--red); border-radius: var(--radius-xs);">Last error: ${goal.lastError}</div>` : ""}
      <button id="resume-goal-btn" style="padding: 10px 20px; background: var(--accent); color: white; border: none; border-radius: var(--radius-sm); font-size: 13px; cursor: pointer; font-weight: 600; width: 100%; margin-bottom: 16px;">Resume this goal</button>
    `;
  }

  // Show steering input + pause button for active goals
  return `
    <div style="display: flex; gap: 8px; margin-bottom: 12px;">
      <button id="pause-goal-btn" style="padding: 8px 16px; background: var(--amber-soft); color: var(--amber); border: 1px solid var(--amber); border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; font-weight: 600;">Pause</button>
    </div>
    <div class="detail-section-title">Steer this goal</div>
    <div style="display: flex; gap: 8px; margin-bottom: 16px;">
      <input type="text" id="steering-input" placeholder="Redirect the agent..." style="flex: 1; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-surface); color: var(--text-primary); font-size: 13px; outline: none;" />
      <button id="steering-send" style="padding: 8px 16px; background: var(--accent); color: white; border: none; border-radius: var(--radius-sm); font-size: 13px; cursor: pointer; font-weight: 500;">Send</button>
    </div>
    ${goal.lastError ? `<div style="font-size: 12px; color: var(--red); margin-bottom: 16px; padding: 8px 12px; background: var(--bg-surface); border: 1px solid var(--red); border-radius: var(--radius-xs);">Last error: ${goal.lastError}</div>` : ""}
  `;
}

export function openAgentDetail(agentId: string): void {
  const agent = state.agents.find(a => a.id === agentId);
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
        <span class="detail-meta-value">${Math.round(agent.successRate)}%</span>
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
          const partner = state.agents.find(a => a.name === p.agentName);
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
      <div class="agent-current-goal" data-goal="${state.goals.find(g => g.title === agent.currentGoal)?.id || ""}">
        <span>${agent.currentGoal}</span>
        <span class="cmdk-item-hint">\u2192</span>
      </div>
    ` : ""}

    ${agent.goalHistory.length > 0 ? `
      <div class="detail-section-title">Goal history</div>
      <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 16px;">
        ${agent.goalHistory.map(h => {
          const hGoal = state.goals.find(g => g.id === h.goalId);
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

  const goalLink = panel.querySelector(".agent-current-goal");
  if (goalLink) {
    goalLink.addEventListener("click", () => {
      const goalId = (goalLink as HTMLElement).dataset.goal;
      if (goalId) { closeDetail(); setTimeout(() => openGoalDetail(goalId), 200); }
    });
  }

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
      if (gid) { closeDetail(); setTimeout(() => callbacks.openGoalDetail(gid), 200); }
    });
  });
}

export function openGoalDetail(goalId: string): void {
  const goal = state.goals.find(g => g.id === goalId);
  if (!goal) return;

  const overlay = document.getElementById("detail-overlay")!;
  const panel = document.getElementById("detail-panel")!;
  const badgeClass = `badge-${goal.status}`;
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

    ${(goal.turnCount > 0 || goal.outcome || goal.retryCount > 0) ? `
    <div class="detail-meta" style="margin-top: 0;">
      ${renderObservabilityMeta(goal)}
    </div>
    ` : ""}

    ${renderSteeringInput(goal.id)}

    ${uniqueAgents.length > 0 ? `
      <div class="detail-section-title">Agents</div>
      <div class="agent-roster">
        ${uniqueAgents.map(name => {
          const ag = state.agents.find(x => x.name === name);
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

    ${goal.blockedBy.length > 0 || goal.enables.length > 0 ? `
      <div class="detail-section-title">Dependencies</div>
      <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px;">
        ${goal.blockedBy.map(id => {
          const dep = state.goals.find(g => g.id === id);
          return dep ? `<div class="interconnect-link" data-goal="${id}" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--bg-surface); border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; border: 1px solid var(--border);">
            <span style="color: var(--amber); font-size: 11px; font-weight: 600;">BLOCKED BY</span>
            <span class="goal-indicator ind-${dep.status}" style="margin: 0;"></span>
            <span style="font-weight: 500;">${dep.title}</span>
            <span style="margin-left: auto; color: var(--text-muted); font-size: 12px;">${Math.round(dep.progress)}%</span>
          </div>` : "";
        }).join("")}
        ${goal.enables.map(id => {
          const dep = state.goals.find(g => g.id === id);
          return dep ? `<div class="interconnect-link" data-goal="${id}" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--bg-surface); border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; border: 1px solid var(--border);">
            <span style="color: var(--green); font-size: 11px; font-weight: 600;">ENABLES</span>
            <span class="goal-indicator ind-${dep.status}" style="margin: 0;"></span>
            <span style="font-weight: 500;">${dep.title}</span>
            <span style="margin-left: auto; color: var(--text-muted); font-size: 12px;">${Math.round(dep.progress)}%</span>
          </div>` : "";
        }).join("")}
      </div>
    ` : ""}

    ${goal.insights.length > 0 ? `
      <div class="detail-section-title">Insights from other goals</div>
      <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;">
        ${goal.insights.map(ins => {
          const fromGoal = state.goals.find(g => g.id === ins.fromGoalId);
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

    ${goal.areasAffected.length > 0 ? (() => {
      const relatedGoals = state.goals.filter(g => g.id !== goal.id && g.areasAffected.some(a => goal.areasAffected.includes(a)));
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

    ${renderToolBreakdown(goal.toolCalls)}

    <div style="display: flex; gap: 8px; margin-bottom: 16px;">
      <button id="save-template-btn" style="padding: 6px 14px; font-size: 12px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; color: var(--text-secondary);">Save as template</button>
    </div>

    <div class="detail-section-title" style="margin-top: 8px;">Timeline</div>
    ${(() => {
      const relatedGoalIds = [...goal.blockedBy, ...goal.enables, ...goal.insights.map(i => i.fromGoalId)];
      const relatedGoals = state.goals.filter(g => relatedGoalIds.includes(g.id));
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

  panel.querySelectorAll(".agent-roster-item, .step-agent-link").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const agentName = (el as HTMLElement).dataset.agentName || "";
      const agentIdAttr = (el as HTMLElement).dataset.agent || "";
      const aid = agentIdAttr || state.agents.find(a => a.name === agentName)?.id;
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

  // Wire steering input
  const steeringInput = panel.querySelector("#steering-input") as HTMLInputElement | null;
  const steeringSend = panel.querySelector("#steering-send");
  if (steeringInput && steeringSend) {
    const sendSteering = () => {
      const msg = steeringInput.value.trim();
      if (!msg) return;
      const bridge = (window as any).fabric;
      if (bridge?.steerGoal) {
        bridge.steerGoal(goalId, msg);
      }
      steeringInput.value = "";
    };
    steeringSend.addEventListener("click", sendSteering);
    steeringInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendSteering();
    });
  }

  // Wire resume button
  const resumeBtn = panel.querySelector("#resume-goal-btn");
  if (resumeBtn) {
    resumeBtn.addEventListener("click", () => {
      const bridge = (window as any).fabric;
      if (bridge?.resumeGoal) {
        bridge.resumeGoal(goalId);
        closeDetail();
      }
    });
  }

  // Wire pause button
  const pauseBtn = panel.querySelector("#pause-goal-btn");
  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => {
      const bridge = (window as any).fabric;
      if (bridge?.pauseGoal) {
        bridge.pauseGoal(goalId);
      }
      // Update local state immediately for responsiveness
      const g = state.goals.find(x => x.id === goalId);
      if (g) {
        g.status = "blocked";
        callbacks.renderSidebarGoals();
        callbacks.renderTitleStatus();
      }
      showToast("Goal paused", `"${goal.title}" has been paused`, "var(--amber)");
      closeDetail();
    });
  }

  // Wire save as template
  const saveTemplateBtn = panel.querySelector("#save-template-btn");
  if (saveTemplateBtn) {
    saveTemplateBtn.addEventListener("click", () => {
      state.templates.push({
        id: `tmpl-${Date.now()}`,
        name: goal.title,
        description: goal.title,
        createdAt: Date.now(),
      });
      saveTemplates();
      showToast("Template saved", `"${goal.title}" saved as template`, "var(--accent)");
      (saveTemplateBtn as HTMLButtonElement).disabled = true;
      (saveTemplateBtn as HTMLButtonElement).textContent = "Saved";
    });
  }
}

export function closeDetail(): void {
  document.getElementById("detail-overlay")!.classList.remove("open");
}
