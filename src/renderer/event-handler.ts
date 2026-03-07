import { state, callbacks } from './state';
import { showToast } from './toasts';
import { renderAllWork, renderActivity, renderNeedsYou } from './views';
import { renderCosts } from './view-costs';

export function handleFabricEvent(event: any): void {
  switch (event.type) {
    case "goal-created": {
      callbacks.renderSidebarGoals();
      callbacks.renderTitleStatus();
      if (state.currentView === "all-work") renderAllWork();
      break;
    }
    case "goal-updated": {
      const data = event.data;
      const existing = state.goals.find(g => g.id === event.goalId);
      if (existing) {
        existing.status = data.status;
        existing.progress = data.progress;
        existing.summary = data.summary;
        existing.agentCount = data.agentCount;
        existing.steps = data.steps;
        existing.timeline = data.timeline;
      }
      callbacks.renderSidebarGoals();
      callbacks.renderTitleStatus();
      if (state.currentView === "all-work") renderAllWork();
      break;
    }
    case "step-updated": {
      callbacks.renderSidebarGoals();
      if (state.currentView === "all-work") renderAllWork();
      break;
    }
    case "activity": {
      state.activityLog.unshift(event.data);
      if (state.activityLog.length > 100) state.activityLog.pop();
      if (state.currentView === "activity") renderActivity();
      break;
    }
    case "toast": {
      showToast(event.data.title, event.data.body, event.data.color);
      break;
    }
    case "agent-message": {
      if (!state.settings.showAgentMessages) break;
      state.activityLog.unshift({
        time: Date.now(),
        text: `<strong>orchestrator</strong> ${event.data.text.slice(0, 120)}${event.data.text.length > 120 ? "..." : ""}`,
      });
      if (state.currentView === "activity") renderActivity();
      break;
    }
    case "cost-update": {
      const costGoal = state.goals.find(g => g.id === event.goalId);
      if (costGoal) {
        costGoal.costUsd = event.data.costUsd;
        costGoal.inputTokens = event.data.inputTokens;
        costGoal.outputTokens = event.data.outputTokens;
      }
      if (state.currentView === "costs") renderCosts();
      callbacks.renderTitleStatus();
      break;
    }
    case "attention": {
      state.attentionItems.push(event.data);
      const badge = document.getElementById("attention-count");
      if (badge) {
        badge.textContent = String(state.attentionItems.length);
        badge.style.display = "";
      }
      if (state.currentView === "needs-you") renderNeedsYou();
      break;
    }
  }
}
