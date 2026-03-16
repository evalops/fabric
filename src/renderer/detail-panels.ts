import { state, callbacks, saveTemplates } from './state';
import { relativeTime, stringToColor, formatTokens, formatDuration, renderDiff, renderThinkingBlock } from './utils';
import { showToast } from './toasts';
import type { Goal, ToolCallRecord } from './types';

// ── Tool categories for Cline-style grouped rendering ────
const TOOL_CATEGORIES: Record<string, { label: string; priority: number }> = {
  Read: { label: "File Access", priority: 1 },
  Grep: { label: "File Access", priority: 1 },
  Glob: { label: "File Access", priority: 1 },
  Edit: { label: "Code Changes", priority: 0 },
  Write: { label: "Code Changes", priority: 0 },
  Bash: { label: "Shell", priority: 2 },
  WebFetch: { label: "Network", priority: 3 },
  LSP: { label: "Language Server", priority: 4 },
};

function getToolCategory(tool: string): string {
  return TOOL_CATEGORIES[tool]?.label || "Other";
}

function getCategoryPriority(category: string): number {
  const entry = Object.values(TOOL_CATEGORIES).find(c => c.label === category);
  return entry?.priority ?? 99;
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

function renderContextBar(goal: Goal): string {
  const totalTokens = goal.inputTokens + goal.outputTokens;
  if (totalTokens === 0) return "";
  // Estimate context window based on model (200K default)
  const contextWindow = 200_000;
  const inputPct = Math.min(100, (goal.inputTokens / contextWindow) * 100);
  const outputPct = Math.min(100 - inputPct, (goal.outputTokens / contextWindow) * 100);
  const totalPct = inputPct + outputPct;
  const barColor = totalPct > 85 ? "var(--red)" : totalPct > 60 ? "var(--amber)" : "";

  return `
    <div class="context-bar">
      <div class="context-bar-header">
        <span class="context-bar-label">Context usage</span>
        <span class="context-bar-value" ${barColor ? `style="color:${barColor}"` : ""}>${formatTokens(totalTokens)} / ${formatTokens(contextWindow)}</span>
      </div>
      <div class="context-bar-track">
        <div class="context-bar-seg input" style="width: ${inputPct}%"></div>
        <div class="context-bar-seg output" style="width: ${outputPct}%"></div>
      </div>
      <div class="context-bar-legend">
        <span class="context-bar-legend-item"><span class="context-bar-legend-dot" style="background:var(--blue)"></span>Input ${formatTokens(goal.inputTokens)}</span>
        <span class="context-bar-legend-item"><span class="context-bar-legend-dot" style="background:var(--accent)"></span>Output ${formatTokens(goal.outputTokens)}</span>
        <span style="margin-left: auto; font-family: var(--font-mono);">${Math.round(totalPct)}%</span>
      </div>
    </div>
  `;
}

function renderToolGroups(toolCalls: ToolCallRecord[]): string {
  if (toolCalls.length === 0) return "";

  // Group by category
  const groups: Record<string, { tools: Record<string, { count: number; totalMs: number; errors: number; lastCall: number; isRecent: boolean }> }> = {};

  const now = Date.now();
  for (const call of toolCalls) {
    const cat = getToolCategory(call.tool);
    if (!groups[cat]) groups[cat] = { tools: {} };
    if (!groups[cat].tools[call.tool]) groups[cat].tools[call.tool] = { count: 0, totalMs: 0, errors: 0, lastCall: 0, isRecent: false };
    const t = groups[cat].tools[call.tool];
    t.count++;
    t.totalMs += call.durationMs;
    if (!call.success) t.errors++;
    if (call.startedAt > t.lastCall) t.lastCall = call.startedAt;
    if (now - call.startedAt < 60_000) t.isRecent = true;
  }

  // Sort categories by priority
  const sortedCats = Object.entries(groups).sort((a, b) => getCategoryPriority(a[0]) - getCategoryPriority(b[0]));

  // Determine which groups to auto-collapse (low-stakes file access with no errors)
  return sortedCats.map(([cat, { tools }]) => {
    const sortedTools = Object.entries(tools).sort((a, b) => b[1].count - a[1].count);
    const totalCalls = sortedTools.reduce((s, [, t]) => s + t.count, 0);
    const totalErrors = sortedTools.reduce((s, [, t]) => s + t.errors, 0);
    const hasActive = sortedTools.some(([, t]) => t.isRecent);
    const isLowStakes = cat === "File Access" && totalErrors === 0;

    return `
      <div class="tool-group ${isLowStakes && !hasActive ? "collapsed" : ""}" data-cat="${cat}">
        <div class="tool-group-header">
          <span class="tool-group-chevron">&#9660;</span>
          ${cat}
          <span class="tool-group-count">${totalCalls}${totalErrors > 0 ? ` / <span style="color:var(--red)">${totalErrors} err</span>` : ""}</span>
        </div>
        <div class="tool-group-items">
          ${sortedTools.map(([tool, stats]) => {
            const isActive = stats.isRecent;
            const hasErr = stats.errors > 0;
            return `<div class="tool-group-item ${isActive ? "active" : ""} ${hasErr ? "errored" : ""}">
              <span class="tool-group-icon" style="color: ${hasErr ? "var(--red)" : isActive ? "var(--blue)" : "var(--green)"}">${hasErr ? "\u2717" : isActive ? "\u25cf" : "\u2713"}</span>
              <span class="tool-group-name">${tool}</span>
              <span class="tool-group-meta">${stats.count}x ${Math.round(stats.totalMs / stats.count)}ms</span>
            </div>`;
          }).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function renderTurnStrip(goal: Goal): string {
  if (goal.turnCount <= 1) return "";

  // Build turn data from tool calls and timeline events
  const turns: { idx: number; type: string; label: string; time: number }[] = [];
  const toolsByTurn: Record<number, ToolCallRecord[]> = {};

  // Group tool calls into approximate turns
  const sortedCalls = [...goal.toolCalls].sort((a, b) => a.startedAt - b.startedAt);
  let turnIdx = 0;
  let lastTime = 0;
  for (const call of sortedCalls) {
    // New turn if >5 seconds gap
    if (lastTime > 0 && call.startedAt - lastTime > 5000) turnIdx++;
    if (!toolsByTurn[turnIdx]) toolsByTurn[turnIdx] = [];
    toolsByTurn[turnIdx].push(call);
    lastTime = call.startedAt;
  }

  for (const [idx, calls] of Object.entries(toolsByTurn)) {
    const hasError = calls.some(c => !c.success);
    const mainTool = calls[0].tool;
    turns.push({
      idx: Number(idx),
      type: hasError ? "error" : "tool",
      label: `T${Number(idx) + 1}: ${mainTool}${calls.length > 1 ? ` +${calls.length - 1}` : ""}`,
      time: calls[0].startedAt,
    });
  }

  if (turns.length <= 1) return "";

  return `
    <div class="turn-strip">
      ${turns.map(t => `
        <span class="turn-chip" data-turn="${t.idx}" title="${new Date(t.time).toLocaleTimeString()}">
          <span class="turn-chip-dot ${t.type}"></span>
          ${t.label}
        </span>
      `).join("")}
    </div>
  `;
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

  const successColor = agent.successRate >= 90 ? "var(--green)" : agent.successRate >= 70 ? "var(--amber)" : "var(--red)";

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
      <div class="detail-meta-item">
        <span class="detail-meta-label">Success rate</span>
        <span class="detail-meta-value" style="color: ${successColor};">${Math.round(agent.successRate)}%</span>
      </div>
    </div>

    <!-- Success rate bar -->
    <div style="margin-bottom: 20px;">
      <div style="height: 6px; background: var(--bg-surface); border-radius: 3px; overflow: hidden;">
        <div style="width: ${agent.successRate}%; height: 100%; background: ${successColor}; border-radius: 3px; transition: width 0.3s;"></div>
      </div>
    </div>

    <div class="agent-caps" style="margin-bottom: 16px;">
      ${agent.capabilities.map(c => `<span class="agent-cap-tag">${c}</span>`).join("")}
    </div>

    <!-- Tabs -->
    <div class="detail-tabs">
      <button class="detail-tab active" data-tab="overview">Overview</button>
      <button class="detail-tab" data-tab="history">History <span class="detail-tab-badge">${agent.goalHistory.length}</span></button>
      <button class="detail-tab" data-tab="activity">Activity <span class="detail-tab-badge">${agent.history.length}</span></button>
    </div>

    <!-- Overview Tab -->
    <div class="detail-tab-content active" data-tab-content="overview">
      ${agent.currentGoal ? `
        <div class="detail-section-title">Currently working on</div>
        <div class="agent-current-goal" data-goal="${state.goals.find(g => g.title === agent.currentGoal)?.id || ""}">
          <span>${agent.currentGoal}</span>
          <span class="cmdk-item-hint">\u2192</span>
        </div>
      ` : `<div style="padding: 16px 0; text-align: center; color: var(--text-muted); font-size: 13px;">Not currently assigned to any goal</div>`}

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

      <div class="detail-section-title">Performance</div>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 16px;">
        <div style="padding: 10px; background: var(--bg-surface); border-radius: var(--radius-sm); text-align: center;">
          <div style="font-size: 20px; font-weight: 700;">${agent.goalHistory.length}</div>
          <div style="font-size: 11px; color: var(--text-muted);">Goals worked</div>
        </div>
        <div style="padding: 10px; background: var(--bg-surface); border-radius: var(--radius-sm); text-align: center;">
          <div style="font-size: 20px; font-weight: 700;">${agent.tasksCompleted}</div>
          <div style="font-size: 11px; color: var(--text-muted);">Tasks done</div>
        </div>
      </div>
    </div>

    <!-- History Tab -->
    <div class="detail-tab-content" data-tab-content="history">
      ${agent.goalHistory.length > 0 ? `
        <div style="display: flex; flex-direction: column; gap: 4px;">
          ${agent.goalHistory.map(h => {
            const hGoal = state.goals.find(g => g.id === h.goalId);
            return `<div class="interconnect-link" data-goal="${h.goalId}" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 12px; cursor: pointer; border-radius: var(--radius-xs); background: var(--bg-surface); border: 1px solid var(--border);">
              ${hGoal ? `<span class="goal-indicator ind-${hGoal.status}" style="margin: 0;"></span>` : ""}
              <span style="font-weight: 500; flex: 1;">${h.goalTitle}</span>
              <span style="padding: 1px 6px; background: var(--bg-hover); border-radius: var(--radius-xs); font-size: 10px; color: var(--text-muted);">${h.role}</span>
              <span style="color: var(--text-muted); font-family: var(--font-mono); font-size: 11px;">${relativeTime(h.time)}</span>
            </div>`;
          }).join("")}
        </div>
      ` : `<div style="text-align: center; color: var(--text-muted); padding: 32px 0; font-size: 13px;">No goal history yet</div>`}
    </div>

    <!-- Activity Tab -->
    <div class="detail-tab-content" data-tab-content="activity">
      ${agent.history.length > 0 ? agent.history.map(ev => `
        <div class="detail-timeline-item">
          <span class="detail-timeline-time">${relativeTime(ev.time)}</span>
          <span>${ev.text}</span>
        </div>
      `).join("") : `<div style="text-align: center; color: var(--text-muted); padding: 32px 0; font-size: 13px;">No activity recorded</div>`}
    </div>
  `;

  overlay.classList.add("open");
  panel.querySelector(".detail-back")!.addEventListener("click", closeDetail);

  // Wire tab switching
  panel.querySelectorAll(".detail-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const tabName = (tab as HTMLElement).dataset.tab!;
      panel.querySelectorAll(".detail-tab").forEach(t => t.classList.remove("active"));
      panel.querySelectorAll(".detail-tab-content").forEach(c => c.classList.remove("active"));
      tab.classList.add("active");
      panel.querySelector(`.detail-tab-content[data-tab-content="${tabName}"]`)?.classList.add("active");
    });
  });

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
  const toolCallCount = goal.toolCalls.length;
  const toolErrorCount = goal.toolCalls.filter(tc => !tc.success).length;

  // Build timeline with cross-goal activity
  const relatedGoalIds = [...goal.blockedBy, ...goal.enables, ...goal.insights.map(i => i.fromGoalId)];
  const relatedGoals = state.goals.filter(g => relatedGoalIds.includes(g.id));
  const crossActivity = relatedGoals.flatMap(rg =>
    rg.timeline.filter(ev => ev.time >= goal.startedAt).map(ev => ({
      ...ev,
      text: `<span style="opacity: 0.6; font-size: 12px;">[${rg.title}]</span> ${ev.text}`,
      cross: true,
    }))
  );
  const mergedTimeline = [...goal.timeline.map(ev => ({ ...ev, cross: false })), ...crossActivity]
    .sort((a, b) => b.time - a.time);

  // Clear old content to ensure old event listeners are garbage collected
  panel.innerHTML = "";

  panel.innerHTML = `
    <div class="detail-back">\u2190 Back</div>
    <div class="detail-status-badge ${badgeClass}">${goal.status}</div>
    <div class="detail-title">${goal.title}</div>
    <div class="detail-summary">${goal.status === "active" ? `<span class="typewriter">${goal.summary}</span>` : goal.summary}</div>

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

    <!-- Context window bar (Cline-inspired token usage visualization) -->
    ${renderContextBar(goal)}

    <!-- Tabs -->
    <div class="detail-tabs">
      <button class="detail-tab active" data-tab="overview">Overview</button>
      <button class="detail-tab" data-tab="reasoning">Reasoning <span class="detail-tab-badge">${(goal.thinking?.length || 0) + (goal.diffs?.length || 0)}</span></button>
      <button class="detail-tab" data-tab="tools">Tools <span class="detail-tab-badge">${toolCallCount}</span></button>
      <button class="detail-tab" data-tab="timeline">Timeline <span class="detail-tab-badge">${mergedTimeline.length}</span></button>
      <button class="detail-tab" data-tab="connections">Links <span class="detail-tab-badge">${goal.blockedBy.length + goal.enables.length + goal.insights.length}</span></button>
      ${(goal.files?.length || 0) > 0 ? `<button class="detail-tab" data-tab="files">Files <span class="detail-tab-badge">${goal.files!.length}</span></button>` : ""}
    </div>

    <!-- Overview Tab -->
    <div class="detail-tab-content active" data-tab-content="overview">
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

      <div class="detail-section-title">Steps <span style="font-weight: 400; text-transform: none; letter-spacing: 0;">(${goal.steps.filter(s => s.state === "done").length}/${goal.steps.length})</span></div>
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

      ${goal.areasAffected.length > 0 ? (() => {
        const areaRelated = state.goals.filter(g => g.id !== goal.id && g.areasAffected.some(a => goal.areasAffected.includes(a)));
        return `
          <div class="detail-section-title">Impact areas</div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: ${areaRelated.length > 0 ? "8px" : "16px"};">
            ${goal.areasAffected.map(a => `<span class="agent-cap-tag">${a}</span>`).join("")}
          </div>
          ${areaRelated.length > 0 ? `
            <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 16px;">
              ${areaRelated.map(rg => {
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

      <div style="display: flex; gap: 8px; margin-bottom: 16px;">
        <button id="save-template-btn" style="padding: 6px 14px; font-size: 12px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; color: var(--text-secondary);">Save as template</button>
      </div>
    </div>

    <!-- Reasoning Tab -->
    <div class="detail-tab-content" data-tab-content="reasoning">
      ${(!goal.thinking || goal.thinking.length === 0) && (!goal.diffs || goal.diffs.length === 0) ? `<div style="text-align: center; color: var(--text-muted); padding: 32px 0; font-size: 13px;">No reasoning or diffs captured yet</div>` : ""}
      ${goal.thinking && goal.thinking.length > 0 ? `
        <div class="detail-section-title">Agent reasoning</div>
        ${goal.thinking.map((t, i) => renderThinkingBlock(t.agent, t.text, t.time, i > 0)).join("")}
      ` : ""}
      ${goal.diffs && goal.diffs.length > 0 ? `
        <div class="detail-section-title">Changes</div>
        ${goal.diffs.map(d => renderDiff(d.file, d.hunks)).join("")}
      ` : ""}
    </div>

    <!-- Tools Tab (Cline-inspired grouped rendering) -->
    <div class="detail-tab-content" data-tab-content="tools">
      ${toolCallCount === 0 ? `<div style="text-align: center; color: var(--text-muted); padding: 32px 0; font-size: 13px;">No tool calls recorded yet</div>` : `
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px;">
          <div style="padding: 10px; background: var(--bg-surface); border-radius: var(--radius-sm); text-align: center;">
            <div style="font-size: 20px; font-weight: 700;">${toolCallCount}</div>
            <div style="font-size: 11px; color: var(--text-muted);">Total calls</div>
          </div>
          <div style="padding: 10px; background: var(--bg-surface); border-radius: var(--radius-sm); text-align: center;">
            <div style="font-size: 20px; font-weight: 700; color: ${toolErrorCount > 0 ? "var(--red)" : "var(--green)"};">${toolErrorCount}</div>
            <div style="font-size: 11px; color: var(--text-muted);">Errors</div>
          </div>
          <div style="padding: 10px; background: var(--bg-surface); border-radius: var(--radius-sm); text-align: center;">
            <div style="font-size: 20px; font-weight: 700;">${toolCallCount > 0 ? Math.round(goal.toolCalls.reduce((s, tc) => s + tc.durationMs, 0) / toolCallCount) : 0}ms</div>
            <div style="font-size: 11px; color: var(--text-muted);">Avg latency</div>
          </div>
        </div>
        <div class="detail-section-title">By category</div>
        ${renderToolGroups(goal.toolCalls)}
        <div class="detail-section-title" style="margin-top: 16px;">Recent calls</div>
        <div style="display: flex; flex-direction: column; gap: 2px; font-size: 11px; max-height: 300px; overflow-y: auto;">
          ${[...goal.toolCalls].reverse().slice(0, 30).map(tc => `
            <div style="display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: var(--radius-xs); background: ${tc.success ? "transparent" : "var(--red-soft)"};">
              <span style="color: ${tc.success ? "var(--green)" : "var(--red)"}; font-size: 10px;">${tc.success ? "\u2713" : "\u2717"}</span>
              <span style="font-family: var(--font-mono); color: var(--text-secondary); min-width: 80px;">${tc.tool}</span>
              <span style="color: var(--text-muted);">${tc.durationMs}ms</span>
              <span style="color: var(--text-muted); margin-left: auto;">${relativeTime(tc.startedAt)}</span>
            </div>
          `).join("")}
        </div>
      `}
    </div>

    <!-- Timeline Tab (with t3code-inspired turn chip strip) -->
    <div class="detail-tab-content" data-tab-content="timeline">
      ${renderTurnStrip(goal)}
      ${mergedTimeline.map(ev => `
        <div class="detail-timeline-item" style="${ev.cross ? "opacity: 0.55; border-left: 2px solid var(--border); padding-left: 10px; margin-left: -2px;" : ""}">
          <span class="detail-timeline-time">${relativeTime(ev.time)}</span>
          <span>${ev.text}</span>
        </div>
      `).join("")}
    </div>

    <!-- Connections Tab -->
    <div class="detail-tab-content" data-tab-content="connections">
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

      ${goal.blockedBy.length === 0 && goal.enables.length === 0 && goal.insights.length === 0 ? `
        <div style="text-align: center; color: var(--text-muted); padding: 32px 0; font-size: 13px;">No dependencies or insights linked</div>
      ` : ""}
    </div>

    <!-- Files Tab -->
    ${(goal.files?.length || 0) > 0 ? `
    <div class="detail-tab-content" data-tab-content="files">
      <div style="display: flex; flex-direction: column; gap: 6px;">
        ${(goal.files || []).map((f: { path: string; action: string; sizeBytes?: number; time: number }) => {
          const name = f.path.split("/").pop() || f.path;
          const ext = name.includes(".") ? name.split(".").pop() : "";
          const sizeLabel = f.sizeBytes ? (f.sizeBytes > 1024 ? `${(f.sizeBytes / 1024).toFixed(1)} KB` : `${f.sizeBytes} B`) : "";
          return `<div class="file-artifact-row" style="display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); transition: border-color 0.15s;">
            <div style="width: 32px; height: 32px; border-radius: var(--radius-xs); background: var(--accent-soft); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" stroke-width="1.5"><path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5L9 1z"/><path d="M9 1v4h4"/></svg>
            </div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${f.path}">${name}</div>
              <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 8px;">
                <span>${f.action}</span>
                ${ext ? `<span>.${ext}</span>` : ""}
                ${sizeLabel ? `<span>${sizeLabel}</span>` : ""}
                <span>${relativeTime(f.time)}</span>
              </div>
            </div>
            <button class="btn btn-primary file-download-btn" data-path="${f.path}" style="padding: 4px 10px; font-size: 11px; flex-shrink: 0;">Download</button>
            <button class="btn file-view-btn" data-path="${f.path}" style="padding: 4px 10px; font-size: 11px; flex-shrink: 0;">View</button>
          </div>`;
        }).join("")}
      </div>
    </div>
    ` : ""}
  `;

  overlay.classList.add("open");
  panel.querySelector(".detail-back")!.addEventListener("click", closeDetail);

  // Wire tab switching
  panel.querySelectorAll(".detail-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const tabName = (tab as HTMLElement).dataset.tab!;
      panel.querySelectorAll(".detail-tab").forEach(t => t.classList.remove("active"));
      panel.querySelectorAll(".detail-tab-content").forEach(c => c.classList.remove("active"));
      tab.classList.add("active");
      panel.querySelector(`.detail-tab-content[data-tab-content="${tabName}"]`)?.classList.add("active");
    });
  });

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

  // Wire thinking block collapse toggles
  panel.querySelectorAll(".thinking-header").forEach(header => {
    header.addEventListener("click", () => {
      const block = header.closest(".thinking-block")!;
      block.classList.toggle("collapsed");
    });
  });

  // Wire tool group collapse toggles
  panel.querySelectorAll(".tool-group-header").forEach(header => {
    header.addEventListener("click", () => {
      const group = header.closest(".tool-group") as HTMLElement;
      const items = group.querySelector(".tool-group-items") as HTMLElement;
      if (group.classList.contains("collapsed")) {
        group.classList.remove("collapsed");
        items.style.maxHeight = items.scrollHeight + "px";
      } else {
        items.style.maxHeight = items.scrollHeight + "px";
        items.offsetHeight; // force reflow
        group.classList.add("collapsed");
      }
    });
  });
  // Set initial max-height for expanded tool groups
  panel.querySelectorAll(".tool-group:not(.collapsed) .tool-group-items").forEach(items => {
    (items as HTMLElement).style.maxHeight = (items as HTMLElement).scrollHeight + "px";
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

  // Wire file download buttons
  panel.querySelectorAll(".file-download-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const filePath = (btn as HTMLElement).dataset.path!;
      const bridge = (window as any).fabric;
      if (!bridge?.readFile) return;
      const result = await bridge.readFile(filePath);
      if (result.success) {
        const blob = new Blob([result.content], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = result.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("Downloaded", result.name, "var(--green)");
      } else {
        showToast("Download failed", result.error, "var(--red)");
      }
    });
  });

  // Wire file view buttons — opens content in a modal-like overlay
  panel.querySelectorAll(".file-view-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const filePath = (btn as HTMLElement).dataset.path!;
      const bridge = (window as any).fabric;
      if (!bridge?.readFile) return;
      const result = await bridge.readFile(filePath);
      if (result.success) {
        const name = result.name;
        const pre = document.createElement("div");
        pre.style.cssText = "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:40px;";
        pre.innerHTML = `<div style="background:var(--bg-base);border:1px solid var(--border);border-radius:var(--radius);max-width:720px;width:100%;max-height:80vh;display:flex;flex-direction:column;box-shadow:var(--shadow-lg);">
          <div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);gap:8px;">
            <span style="font-weight:600;font-size:14px;flex:1;">${name}</span>
            <span style="font-size:11px;color:var(--text-muted);">${result.sizeBytes > 1024 ? (result.sizeBytes / 1024).toFixed(1) + " KB" : result.sizeBytes + " B"}</span>
            <button class="btn" style="padding:4px 10px;font-size:11px;" id="file-view-close">Close</button>
          </div>
          <pre style="flex:1;overflow:auto;padding:16px;margin:0;font-family:var(--font-mono);font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-all;color:var(--text-primary);">${result.content.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</pre>
        </div>`;
        document.body.appendChild(pre);
        pre.addEventListener("click", (ev) => { if (ev.target === pre) pre.remove(); });
        pre.querySelector("#file-view-close")!.addEventListener("click", () => pre.remove());
        document.addEventListener("keydown", function handler(e) {
          if (e.key === "Escape") { pre.remove(); document.removeEventListener("keydown", handler); }
        });
      } else {
        showToast("View failed", result.error, "var(--red)");
      }
    });
  });
}

export function closeDetail(): void {
  document.getElementById("detail-overlay")!.classList.remove("open");
}
