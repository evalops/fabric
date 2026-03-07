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
        // Sync observability fields from engine
        if (data.turnCount !== undefined) existing.turnCount = data.turnCount;
        if (data.outcome !== undefined) existing.outcome = data.outcome;
        if (data.retryCount !== undefined) existing.retryCount = data.retryCount;
        if (data.lastError !== undefined) existing.lastError = data.lastError;
        if (data.sessionId !== undefined) existing.sessionId = data.sessionId;
        if (data.completedAt !== undefined) existing.completedAt = data.completedAt;
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
    case "tool-call": {
      // Append tool call record to the goal's toolCalls array
      const tcGoal = state.goals.find(g => g.id === event.goalId);
      if (tcGoal) {
        tcGoal.toolCalls.push(event.data);
      }
      // Surface errors as activity
      if (!event.data.success) {
        state.activityLog.unshift({
          time: Date.now(),
          text: `<strong>tool error</strong> ${event.data.tool} failed after ${event.data.durationMs}ms`,
        });
        if (state.currentView === "activity") renderActivity();
      }
      break;
    }
    case "observability": {
      // Goal completion summary — update the goal with final metrics
      const obsGoal = state.goals.find(g => g.id === event.goalId);
      if (obsGoal) {
        obsGoal.outcome = event.data.outcome;
        obsGoal.turnCount = event.data.turnCount;
      }
      state.activityLog.unshift({
        time: Date.now(),
        text: `<strong>summary</strong> ${event.data.outcome}: ${event.data.turnCount} turns, ${event.data.toolCallCount} tool calls, $${event.data.totalCost?.toFixed(2)} cost, ${Math.round((event.data.durationMs || 0) / 1000)}s duration`,
      });
      if (state.currentView === "activity") renderActivity();
      callbacks.renderTitleStatus();
      break;
    }
    case "steering": {
      state.activityLog.unshift({
        time: Date.now(),
        text: `<strong>steering</strong> sent to goal: "${event.data.message}"`,
      });
      if (state.currentView === "activity") renderActivity();
      break;
    }
    case "retry": {
      const retryGoal = state.goals.find(g => g.id === event.goalId);
      if (retryGoal) {
        retryGoal.retryCount = event.data.attempt;
        retryGoal.lastError = event.data.error;
      }
      showToast(
        "Retrying",
        `Attempt ${event.data.attempt}/${event.data.maxRetries} in ${Math.round(event.data.delayMs / 1000)}s`,
        "var(--amber)"
      );
      state.activityLog.unshift({
        time: Date.now(),
        text: `<strong>retry</strong> attempt ${event.data.attempt}/${event.data.maxRetries} — ${event.data.error}`,
      });
      if (state.currentView === "activity") renderActivity();
      break;
    }
    case "compaction": {
      state.activityLog.unshift({
        time: Date.now(),
        text: `<strong>compaction</strong> context compressed (${event.data.trigger}, ${Math.round((event.data.preTokens || 0) / 1000)}k tokens, turn ${event.data.turnCount})`,
      });
      if (state.currentView === "activity") renderActivity();
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
