import { state, getTotalCost, getTotalTokens } from './state';
import { formatTokens, formatDuration, stringToColor, sparkline } from './utils';
import { openGoalDetail } from './detail-panels';

// Dynamic pricing — reads from model catalog via bridge, falls back to Sonnet defaults
let _cachedModelInfo: { id: string; input: number; output: number; label: string } | null = null;

function getModelPricing(): { input: number; output: number; label: string } {
  const currentModel = state.settings.model;
  // Check cache
  if (_cachedModelInfo && _cachedModelInfo.id === currentModel) {
    return _cachedModelInfo;
  }
  // Try to load from bridge (async population — will be available after first settings tab visit)
  const bridge = (window as any).fabric;
  if (bridge?.getModels) {
    bridge.getModels().then((models: { id: string; name: string; costInput: number; costOutput: number }[]) => {
      const m = models.find((m: { id: string }) => m.id === currentModel);
      if (m) {
        _cachedModelInfo = { id: currentModel, input: m.costInput, output: m.costOutput, label: m.name };
      }
    }).catch(() => {});
  }
  // Return cached or default
  if (_cachedModelInfo && _cachedModelInfo.id === currentModel) return _cachedModelInfo;
  // Extract a short label from the model ID
  const shortLabel = currentModel.includes("/") ? currentModel.split("/").pop()! : currentModel;
  return { input: 3.00, output: 15.00, label: shortLabel };
}

export function renderCosts(): void {
  const feed = document.getElementById("feed")!;
  const totalCost = getTotalCost();
  const tokens = getTotalTokens();
  const totalTokens = tokens.input + tokens.output;
  const activeGoals = state.goals.filter(g => g.status === "active");
  const completedGoals = state.goals.filter(g => g.status === "complete");
  const failedGoals = state.goals.filter(g => g.outcome === "error" || g.outcome === "budget_exhausted" || g.outcome === "turns_exhausted");
  const sortedGoals = [...state.goals].sort((a, b) => b.costUsd - a.costUsd);
  const maxGoalCost = sortedGoals[0]?.costUsd || 1;

  const completedSteps = state.goals.reduce((sum, g) => sum + g.steps.filter(s => s.state === "done").length, 0);
  const totalSteps = state.goals.reduce((sum, g) => sum + g.steps.length, 0);
  const costPerStep = completedSteps > 0 ? totalCost / completedSteps : 0;
  const costPerGoalCompleted = completedGoals.length > 0 ? completedGoals.reduce((s, g) => s + g.costUsd, 0) / completedGoals.length : 0;
  const avgDuration = completedGoals.length > 0 ? completedGoals.reduce((s, g) => s + ((g.completedAt || Date.now()) - g.startedAt), 0) / completedGoals.length : 0;
  const avgTurns = completedGoals.length > 0 ? completedGoals.reduce((s, g) => s + (g.turnCount || 0), 0) / completedGoals.length : 0;
  const totalRetries = state.goals.reduce((sum, g) => sum + (g.retryCount || 0), 0);
  const successRate = (completedGoals.length + failedGoals.length) > 0
    ? Math.round((completedGoals.filter(g => g.outcome === "success").length / (completedGoals.length + failedGoals.length)) * 100)
    : 0;
  const pricing = getModelPricing();

  const agentCosts: Record<string, { cost: number; tokens: number; goals: number }> = {};
  state.goals.forEach(g => {
    const agentNames = [...new Set(g.steps.filter(s => s.agent).map(s => s.agent!))];
    const perAgentCost = agentNames.length > 0 ? g.costUsd / agentNames.length : 0;
    const perAgentTokens = agentNames.length > 0 ? (g.inputTokens + g.outputTokens) / agentNames.length : 0;
    agentNames.forEach(name => {
      if (!agentCosts[name]) agentCosts[name] = { cost: 0, tokens: 0, goals: 0 };
      agentCosts[name].cost += perAgentCost;
      agentCosts[name].tokens += perAgentTokens;
      agentCosts[name].goals += 1;
    });
  });
  const sortedAgentCosts = Object.entries(agentCosts).sort(([, a], [, b]) => b.cost - a.cost);
  const maxAgentCost = sortedAgentCosts[0]?.[1].cost || 1;

  const areaCosts: Record<string, { cost: number; goalCount: number }> = {};
  state.goals.forEach(g => {
    const perArea = g.areasAffected.length > 0 ? g.costUsd / g.areasAffected.length : 0;
    g.areasAffected.forEach(area => {
      if (!areaCosts[area]) areaCosts[area] = { cost: 0, goalCount: 0 };
      areaCosts[area].cost += perArea;
      areaCosts[area].goalCount += 1;
    });
  });
  const sortedAreaCosts = Object.entries(areaCosts).sort(([, a], [, b]) => b.cost - a.cost);

  const now = Date.now();
  const hours = 6;
  const hourlySpend: number[] = new Array(hours).fill(0);
  state.goals.forEach(g => {
    const hourIdx = Math.min(hours - 1, Math.floor((now - g.startedAt) / 3_600_000));
    if (hourIdx >= 0 && hourIdx < hours) hourlySpend[hours - 1 - hourIdx] += g.costUsd;
  });
  const maxHourly = Math.max(...hourlySpend, 0.01);

  const hoursActive = state.goals.length > 0 ? Math.max(1, (now - Math.min(...state.goals.map(g => g.startedAt))) / 3_600_000) : 1;
  const hourlyRate = totalCost / hoursActive;
  const dailyProjection = hourlyRate * 24;
  const monthlyProjection = hourlyRate * 24 * 30;

  const budgetLimit = state.settings.maxBudgetUsd;

  feed.innerHTML = `
    <div class="settings-view" style="max-width: 720px;">

      <!-- Hero metrics row -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px;">
        <div class="settings-card" style="margin-bottom: 0; padding: 16px 18px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="font-size: 28px; font-weight: 700; letter-spacing: -1px;">$${totalCost.toFixed(2)}</div>
            ${sparkline(hourlySpend, 48, 20)}
          </div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Total spend</div>
        </div>
        <div class="settings-card" style="margin-bottom: 0; padding: 16px 18px;">
          <div style="font-size: 28px; font-weight: 700; letter-spacing: -1px;">${formatTokens(totalTokens)}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Tokens used</div>
        </div>
        <div class="settings-card" style="margin-bottom: 0; padding: 16px 18px;">
          <div style="font-size: 28px; font-weight: 700; letter-spacing: -1px; color: ${hourlyRate > 5 ? "var(--amber)" : "var(--text-primary)"};">$${hourlyRate.toFixed(2)}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Per hour</div>
        </div>
        <div class="settings-card" style="margin-bottom: 0; padding: 16px 18px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="font-size: 28px; font-weight: 700; letter-spacing: -1px;">${state.goals.length}</div>
            ${sparkline(
              [state.goals.filter(g => g.status === "complete").length,
               state.goals.filter(g => g.status === "active").length,
               state.goals.filter(g => g.status === "blocked").length,
               state.goals.filter(g => g.status === "failed").length],
              40, 20, "var(--blue)"
            )}
          </div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Goals</div>
        </div>
      </div>

      <!-- Spend over time -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Spend over time</div>
          <div class="settings-card-desc">Last ${hours} hours</div>
        </div>
        <div style="display: flex; align-items: flex-end; gap: 4px; height: 80px; padding-top: 8px;">
          ${hourlySpend.map((val, i) => `
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%;">
              <div style="flex: 1; width: 100%; display: flex; align-items: flex-end;">
                <div style="width: 100%; height: ${Math.max(2, (val / maxHourly) * 100)}%; background: var(--accent); border-radius: 3px 3px 0 0; transition: height 0.3s; min-height: 2px;"></div>
              </div>
              <div style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">${i === hours - 1 ? "now" : `-${hours - 1 - i}h`}</div>
            </div>
          `).join("")}
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--bg-surface);">
          <span>Peak: $${maxHourly.toFixed(2)}/hr</span>
          <span>Avg: $${(totalCost / hours).toFixed(2)}/hr</span>
        </div>
      </div>

      <!-- Projections -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Projections</div>
          <div class="settings-card-desc">At current run rate of $${hourlyRate.toFixed(2)}/hr</div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
          <div>
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px;">Today</div>
            <div style="font-size: 20px; font-weight: 700;">$${dailyProjection.toFixed(0)}</div>
          </div>
          <div>
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px;">This week</div>
            <div style="font-size: 20px; font-weight: 700;">$${(dailyProjection * 7).toFixed(0)}</div>
          </div>
          <div>
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px;">This month</div>
            <div style="font-size: 20px; font-weight: 700; color: ${monthlyProjection > 500 ? "var(--amber)" : "var(--text-primary)"};">$${monthlyProjection.toFixed(0)}</div>
          </div>
        </div>
        ${activeGoals.length > 0 && hourlyRate > 0 ? (() => {
          const totalBudgetRemaining = Math.max(0, budgetLimit * activeGoals.length - activeGoals.reduce((s, g) => s + g.costUsd, 0));
          const hoursToExhaustion = totalBudgetRemaining / hourlyRate;
          const exhaustionColor = hoursToExhaustion < 1 ? "var(--red)" : hoursToExhaustion < 4 ? "var(--amber)" : "var(--green)";
          const exhaustionLabel = hoursToExhaustion < 1 ? `${Math.round(hoursToExhaustion * 60)}m` : hoursToExhaustion < 24 ? `${hoursToExhaustion.toFixed(1)}h` : `${(hoursToExhaustion / 24).toFixed(1)}d`;
          return `
          <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--bg-surface); display: flex; align-items: center; gap: 12px;">
            <div style="width: 10px; height: 10px; border-radius: 50%; background: ${exhaustionColor}; flex-shrink: 0; ${hoursToExhaustion < 1 ? "animation: graph-pulse 1.5s ease-in-out infinite;" : ""}"></div>
            <div style="flex: 1;">
              <div style="font-size: 13px; font-weight: 600; color: ${exhaustionColor};">Budget exhaustion in ~${exhaustionLabel}</div>
              <div style="font-size: 11px; color: var(--text-muted);">$${totalBudgetRemaining.toFixed(2)} remaining across ${activeGoals.length} active goal${activeGoals.length > 1 ? "s" : ""} at $${hourlyRate.toFixed(2)}/hr</div>
            </div>
          </div>`;
        })() : ""}
      </div>

      <!-- Efficiency -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Efficiency</div>
          <div class="settings-card-desc">${completedSteps}/${totalSteps} steps completed across ${state.goals.length} goals · ${pricing.label} pricing</div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
          <div style="padding: 12px; background: var(--bg-surface); border-radius: var(--radius-sm);">
            <div style="font-size: 18px; font-weight: 700;">$${costPerStep.toFixed(2)}</div>
            <div style="font-size: 12px; color: var(--text-muted);">Cost per step</div>
          </div>
          <div style="padding: 12px; background: var(--bg-surface); border-radius: var(--radius-sm);">
            <div style="font-size: 18px; font-weight: 700;">$${costPerGoalCompleted.toFixed(2)}</div>
            <div style="font-size: 12px; color: var(--text-muted);">Cost per completed goal</div>
          </div>
          <div style="padding: 12px; background: var(--bg-surface); border-radius: var(--radius-sm);">
            <div style="font-size: 18px; font-weight: 700;">${avgDuration > 0 ? formatDuration(0, avgDuration) : "\u2014"}</div>
            <div style="font-size: 12px; color: var(--text-muted);">Avg goal duration</div>
          </div>
          <div style="padding: 12px; background: var(--bg-surface); border-radius: var(--radius-sm);">
            <div style="font-size: 18px; font-weight: 700;">${avgTurns > 0 ? avgTurns.toFixed(1) : "\u2014"}</div>
            <div style="font-size: 12px; color: var(--text-muted);">Avg turns per goal</div>
          </div>
          <div style="padding: 12px; background: var(--bg-surface); border-radius: var(--radius-sm);">
            <div style="font-size: 18px; font-weight: 700; color: ${successRate >= 80 ? "var(--green)" : successRate >= 50 ? "var(--amber)" : "var(--red)"};">${successRate}%</div>
            <div style="font-size: 12px; color: var(--text-muted);">Success rate</div>
          </div>
          <div style="padding: 12px; background: var(--bg-surface); border-radius: var(--radius-sm);">
            <div style="font-size: 18px; font-weight: 700; color: ${totalRetries > 5 ? "var(--amber)" : "var(--text-primary)"};">${totalRetries}</div>
            <div style="font-size: 12px; color: var(--text-muted);">Total retries</div>
          </div>
        </div>
      </div>

      <!-- Token breakdown -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Token breakdown</div>
          <div class="settings-card-desc">${formatTokens(tokens.input)} input \u00b7 ${formatTokens(tokens.output)} output \u00b7 ${totalTokens > 0 ? Math.round((tokens.output / totalTokens) * 100) : 0}% output-heavy \u00b7 ${pricing.label} rates</div>
        </div>
        <div style="display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: var(--bg-surface);">
          <div style="width: ${totalTokens > 0 ? (tokens.input / totalTokens) * 100 : 50}%; background: var(--blue); transition: width 0.3s;"></div>
          <div style="width: ${totalTokens > 0 ? (tokens.output / totalTokens) * 100 : 50}%; background: var(--accent); transition: width 0.3s;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 10px; font-size: 12px;">
          <div>
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--blue); margin-right: 4px;"></span>
            <span style="color: var(--text-secondary);">Input</span>
            <span style="color: var(--text-muted); margin-left: 4px;">${formatTokens(tokens.input)}</span>
            <span style="color: var(--text-muted); font-family: var(--font-mono);"> (~$${((tokens.input / 1_000_000) * pricing.input).toFixed(2)})</span>
          </div>
          <div>
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-right: 4px;"></span>
            <span style="color: var(--text-secondary);">Output</span>
            <span style="color: var(--text-muted); margin-left: 4px;">${formatTokens(tokens.output)}</span>
            <span style="color: var(--text-muted); font-family: var(--font-mono);"> (~$${((tokens.output / 1_000_000) * pricing.output).toFixed(2)})</span>
          </div>
        </div>
      </div>

      <!-- Cost by agent -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Cost by agent</div>
          <div class="settings-card-desc">${sortedAgentCosts.length} agents with spend</div>
        </div>
        ${sortedAgentCosts.slice(0, 8).map(([name, data]) => `
          <div style="padding: 8px 0; border-top: 1px solid var(--bg-surface);">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <div class="agent-avatar-sm" style="background: ${stringToColor(name)}; width: 22px; height: 22px; font-size: 10px;">${name.charAt(0).toUpperCase()}</div>
              <span style="font-size: 13px; font-weight: 500; flex: 1;">${name}</span>
              <span style="font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary);">${data.goals} goal${data.goals > 1 ? "s" : ""}</span>
              <span style="font-family: var(--font-mono); font-size: 13px; font-weight: 600; width: 60px; text-align: right;">$${data.cost.toFixed(2)}</span>
            </div>
            <div style="height: 3px; background: var(--bg-surface); border-radius: 2px; overflow: hidden; margin-left: 30px;">
              <div style="width: ${(data.cost / maxAgentCost) * 100}%; height: 100%; background: ${stringToColor(name)}; border-radius: 2px; opacity: 0.7;"></div>
            </div>
          </div>
        `).join("")}
      </div>

      <!-- Cost by area -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Cost by area</div>
          <div class="settings-card-desc">Where the money goes</div>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${sortedAreaCosts.map(([area, data]) => {
            const pct = totalCost > 0 ? (data.cost / totalCost) * 100 : 0;
            return `<div style="padding: 8px 14px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 90px;">
              <span style="font-size: 12px; font-weight: 500;">${area}</span>
              <span style="font-family: var(--font-mono); font-size: 14px; font-weight: 700;">$${data.cost.toFixed(2)}</span>
              <span style="font-size: 10px; color: var(--text-muted);">${pct.toFixed(0)}% \u00b7 ${data.goalCount} goal${data.goalCount > 1 ? "s" : ""}</span>
            </div>`;
          }).join("")}
        </div>
      </div>

      <!-- Cost by goal -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Cost by goal</div>
          <div class="settings-card-desc">${activeGoals.length} active \u00b7 ${completedGoals.length} completed</div>
        </div>
        ${sortedGoals.map(g => {
          const budgetPct = budgetLimit > 0 ? (g.costUsd / budgetLimit) * 100 : 0;
          const duration = formatDuration(g.startedAt, g.completedAt);
          const goalTokens = g.inputTokens + g.outputTokens;
          const toolErrors = g.toolCalls.filter(tc => !tc.success).length;
          return `
            <div class="cost-goal-row" data-goal="${g.id}" style="padding: 12px 0; border-top: 1px solid var(--bg-surface); cursor: pointer;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <div class="goal-indicator ind-${g.status}" style="margin-top: 0;"></div>
                <span style="font-size: 13px; font-weight: 500; flex: 1;">${g.title}</span>
                ${g.outcome ? `<span class="outcome-badge outcome-${g.outcome}" style="font-size: 10px; padding: 1px 6px;">${g.outcome}</span>` : ""}
                <span style="font-family: var(--font-mono); font-size: 15px; font-weight: 700;">$${g.costUsd.toFixed(2)}</span>
              </div>
              <div style="display: flex; gap: 16px; font-size: 11px; color: var(--text-muted); margin-bottom: 6px; padding-left: 16px;">
                <span>${formatTokens(goalTokens)} tokens</span>
                <span>${duration}</span>
                <span>${g.steps.filter(s => s.state === "done").length}/${g.steps.length} steps</span>
                <span>${g.turnCount || 0} turns</span>
                <span>${g.toolCalls.length} tool calls${toolErrors > 0 ? ` (${toolErrors} err)` : ""}</span>
                ${g.retryCount ? `<span style="color: var(--amber);">${g.retryCount} retries</span>` : ""}
              </div>
              <div style="display: flex; align-items: center; gap: 8px; padding-left: 16px;">
                <div style="flex: 1; height: 6px; background: var(--bg-surface); border-radius: 3px; overflow: hidden; position: relative;">
                  <div style="width: ${Math.min(100, (g.costUsd / maxGoalCost) * 100)}%; height: 100%; background: var(--accent); border-radius: 3px; transition: width 0.3s;"></div>
                </div>
                <span style="font-size: 10px; color: ${budgetPct > 80 ? "var(--amber)" : "var(--text-muted)"}; font-family: var(--font-mono); flex-shrink: 0;">${budgetPct.toFixed(0)}% of limit</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>

      <!-- Tool call summary -->
      ${(() => {
        const toolStats: Record<string, { count: number; errors: number; totalMs: number }> = {};
        state.goals.forEach(g => g.toolCalls.forEach(tc => {
          if (!toolStats[tc.tool]) toolStats[tc.tool] = { count: 0, errors: 0, totalMs: 0 };
          toolStats[tc.tool].count++;
          if (!tc.success) toolStats[tc.tool].errors++;
          toolStats[tc.tool].totalMs += tc.durationMs;
        }));
        const sorted = Object.entries(toolStats).sort(([, a], [, b]) => b.count - a.count);
        const totalCalls = sorted.reduce((s, [, d]) => s + d.count, 0);
        if (totalCalls === 0) return "";
        return `
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Tool usage</div>
          <div class="settings-card-desc">${totalCalls} total calls across ${sorted.length} tools</div>
        </div>
        <div style="font-size: 11px;">
          <div style="display: grid; grid-template-columns: 1fr 50px 60px 50px; gap: 4px; padding: 6px 0; border-bottom: 1px solid var(--bg-surface); color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">
            <span>Tool</span><span style="text-align: right;">Calls</span><span style="text-align: right;">Avg ms</span><span style="text-align: right;">Errors</span>
          </div>
          ${sorted.slice(0, 12).map(([name, d]) => `
            <div style="display: grid; grid-template-columns: 1fr 50px 60px 50px; gap: 4px; padding: 6px 0; border-bottom: 1px solid var(--bg-surface);">
              <span style="font-family: var(--font-mono); color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${name}</span>
              <span style="text-align: right; font-family: var(--font-mono); color: var(--text-primary);">${d.count}</span>
              <span style="text-align: right; font-family: var(--font-mono); color: var(--text-muted);">${Math.round(d.totalMs / d.count)}</span>
              <span style="text-align: right; font-family: var(--font-mono); color: ${d.errors > 0 ? "var(--red)" : "var(--text-muted)"};">${d.errors}</span>
            </div>
          `).join("")}
        </div>
      </div>`;
      })()}

      <!-- Budget -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Budget</div>
          <div class="settings-card-desc">Per-goal limit: $${budgetLimit.toFixed(2)} \u00b7 Effective total: $${(budgetLimit * state.goals.length).toFixed(2)}</div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px;">
          <div style="padding: 12px; background: var(--bg-surface); border-radius: var(--radius-sm);">
            <div style="font-size: 18px; font-weight: 700; color: ${totalCost > budgetLimit * state.goals.length * 0.8 ? "var(--amber)" : "var(--green)"};">${Math.round((totalCost / (budgetLimit * state.goals.length)) * 100)}%</div>
            <div style="font-size: 12px; color: var(--text-muted);">Budget used</div>
          </div>
          <div style="padding: 12px; background: var(--bg-surface); border-radius: var(--radius-sm);">
            <div style="font-size: 18px; font-weight: 700; color: var(--green);">$${Math.max(0, budgetLimit * state.goals.length - totalCost).toFixed(2)}</div>
            <div style="font-size: 12px; color: var(--text-muted);">Remaining</div>
          </div>
        </div>
        <div style="height: 10px; background: var(--bg-surface); border-radius: 5px; overflow: hidden; position: relative;">
          <div style="width: ${Math.min(100, (totalCost / (budgetLimit * state.goals.length)) * 100)}%; height: 100%; background: ${totalCost > budgetLimit * state.goals.length * 0.8 ? "var(--amber)" : "var(--green)"}; border-radius: 5px; transition: width 0.3s;"></div>
          ${state.goals.map((_, i) => `<div style="position: absolute; left: ${((i + 1) / state.goals.length) * 100}%; top: 0; bottom: 0; width: 1px; background: var(--border); opacity: 0.5;"></div>`).join("")}
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; color: var(--text-muted);">
          <span>$0</span>
          <span>$${(budgetLimit * state.goals.length).toFixed(2)}</span>
        </div>

        <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--bg-surface);">
          <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; color: var(--text-muted); margin-bottom: 8px;">Per-goal budget utilization</div>
          ${state.goals.map(g => {
            const pct = budgetLimit > 0 ? Math.min(100, (g.costUsd / budgetLimit) * 100) : 0;
            const color = pct > 90 ? "var(--red)" : pct > 70 ? "var(--amber)" : "var(--green)";
            return `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="font-size: 11px; width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-secondary);">${g.title}</span>
              <div style="flex: 1; height: 4px; background: var(--bg-surface); border-radius: 2px; overflow: hidden;">
                <div style="width: ${pct}%; height: 100%; background: ${color}; border-radius: 2px;"></div>
              </div>
              <span style="font-size: 10px; font-family: var(--font-mono); color: ${pct > 70 ? color : "var(--text-muted)"}; width: 32px; text-align: right;">${pct.toFixed(0)}%</span>
            </div>`;
          }).join("")}
        </div>
      </div>

    </div>
  `;

  feed.querySelectorAll(".cost-goal-row").forEach(el => {
    el.addEventListener("click", () => openGoalDetail((el as HTMLElement).dataset.goal!));
  });
}
