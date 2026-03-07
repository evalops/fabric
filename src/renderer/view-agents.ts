import type { Agent } from './types';
import { state } from './state';
import { stringToColor } from './utils';
import { openAgentDetail } from './detail-panels';

export function renderAgents(): void {
  const feed = document.getElementById("feed")!;
  const working = state.agents.filter(a => a.status === "working");
  const idle = state.agents.filter(a => a.status === "idle");

  feed.innerHTML = `
    ${working.length ? `<div class="agents-section-label">Working (${working.length})</div>` : ""}
    ${working.map(a => renderAgentCard(a)).join("")}
    ${idle.length ? `<div class="agents-section-label">Idle (${idle.length})</div>` : ""}
    ${idle.map(a => renderAgentCard(a)).join("")}
  `;

  feed.querySelectorAll(".agent-card").forEach(el => {
    el.addEventListener("click", () => {
      openAgentDetail((el as HTMLElement).dataset.agent!);
    });
  });
}

function renderAgentCard(a: Agent): string {
  const statusColor = a.status === "working" ? "var(--blue)" : "var(--green)";
  return `
    <div class="agent-card" data-agent="${a.id}">
      <div class="agent-card-top">
        <div class="agent-avatar-sm" style="background: ${stringToColor(a.name)}">${a.name.charAt(0).toUpperCase()}</div>
        <div class="agent-card-info">
          <div class="agent-card-name">${a.name}</div>
          <div class="agent-card-status">
            <span class="agent-status-dot" style="background: ${statusColor}"></span>
            ${a.status}${a.currentStep ? ` \u2014 ${a.currentStep}` : ""}
          </div>
        </div>
        <div class="agent-card-stats">
          <span>${a.tasksCompleted} tasks</span>
          <span>${a.costToday}</span>
        </div>
      </div>
      <div class="agent-card-caps">
        ${a.capabilities.slice(0, 3).map(c => `<span class="agent-cap-tag">${c}</span>`).join("")}
        ${a.capabilities.length > 3 ? `<span class="agent-cap-tag">+${a.capabilities.length - 3}</span>` : ""}
      </div>
    </div>
  `;
}
