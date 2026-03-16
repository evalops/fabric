import { state, callbacks } from './state';
import { showToast } from './toasts';
import { renderAllWork, renderActivity, renderNeedsYou } from './views';
import { renderCosts } from './view-costs';
import { renderGraph } from './view-graph';
import { renderAgents } from './view-agents';
import { deriveAgentsFromGoals } from './renderer';
import type { ChatToolCall } from './types';

export function handleFabricEvent(event: any): void {
  switch (event.type) {
    case "goal-created": {
      // Add goal to state if it doesn't already exist (may have been added optimistically)
      const newGoal = event.data;
      if (newGoal && newGoal.id && !state.goals.find(g => g.id === newGoal.id)) {
        state.goals.unshift({
          id: newGoal.id,
          title: newGoal.title || "Untitled",
          summary: newGoal.summary || "",
          status: newGoal.status || "active",
          progress: newGoal.progress || 0,
          agentCount: newGoal.agentCount || 0,
          steps: newGoal.steps || [],
          timeline: newGoal.timeline || [],
          costUsd: newGoal.costUsd || 0,
          inputTokens: newGoal.inputTokens || 0,
          outputTokens: newGoal.outputTokens || 0,
          startedAt: newGoal.startedAt || Date.now(),
          blockedBy: newGoal.blockedBy || [],
          enables: newGoal.enables || [],
          insights: newGoal.insights || [],
          areasAffected: newGoal.areasAffected || [],
          turnCount: newGoal.turnCount || 0,
          toolCalls: newGoal.toolCalls || [],
          retryCount: newGoal.retryCount || 0,
          thinking: newGoal.thinking || [],
          diffs: newGoal.diffs || [],
        });
      }
      deriveAgentsFromGoals();
      callbacks.renderSidebarGoals();
      callbacks.renderTitleStatus();
      if (state.currentView === "all-work") renderAllWork();
      if (state.currentView === "graph") renderGraph();
      if (state.currentView === "agents") renderAgents();
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
      deriveAgentsFromGoals();
      callbacks.renderSidebarGoals();
      callbacks.renderTitleStatus();
      if (state.currentView === "all-work") renderAllWork();
      if (state.currentView === "graph") renderGraph();
      if (state.currentView === "agents") renderAgents();
      break;
    }
    case "step-updated": {
      deriveAgentsFromGoals();
      callbacks.renderSidebarGoals();
      if (state.currentView === "all-work") renderAllWork();
      if (state.currentView === "graph") renderGraph();
      if (state.currentView === "agents") renderAgents();
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
      // Surface errors across all relevant views (cross-view error rippling)
      if (!event.data.success) {
        state.activityLog.unshift({
          time: Date.now(),
          text: `<strong>tool error</strong> ${event.data.tool} failed after ${event.data.durationMs}ms`,
        });
        const errorBadge = document.getElementById("error-count");
        if (errorBadge) {
          const count = parseInt(errorBadge.textContent || "0") + 1;
          errorBadge.textContent = String(count);
          errorBadge.style.display = "";
        }
        // Ripple error state to sidebar, active view, and title
        callbacks.renderSidebarGoals();
        callbacks.renderTitleStatus();
        if (state.currentView === "activity") renderActivity();
        if (state.currentView === "all-work") renderAllWork();
        if (state.currentView === "graph") renderGraph();
        if (state.currentView === "agents") renderAgents();
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
      if (state.currentView === "all-work") renderAllWork();
      if (state.currentView === "costs") renderCosts();
      if (state.currentView === "graph") renderGraph();
      callbacks.renderSidebarGoals();
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
    case "file-artifact": {
      const fileGoal = state.goals.find(g => g.id === event.goalId);
      if (fileGoal) {
        if (!fileGoal.files) fileGoal.files = [];
        fileGoal.files.push(event.data);
      }
      // Update views that show files
      if (state.currentView === "all-work") renderAllWork();
      break;
    }
    case "attention": {
      state.attentionItems.push(event.data);
      const badge = document.getElementById("attention-count");
      if (badge) {
        badge.textContent = String(state.attentionItems.length);
        badge.style.display = "";
      }
      // Urgent items auto-switch to "Needs you" view
      const isUrgent = event.data.kind === "crit" || event.data.kind === "warn";
      if (isUrgent) {
        callbacks.switchView("needs-you");
        showToast(
          event.data.kind === "crit" ? "Agent blocked" : "Agent needs you",
          event.data.title?.slice(0, 100) || "An agent needs your input",
          event.data.kind === "crit" ? "var(--red)" : "var(--amber)",
        );
      } else if (state.currentView === "needs-you") {
        renderNeedsYou();
      }
      break;
    }

    // ── Chat events (coordinator responses) ──────────
    case "chat-text": {
      // Find the streaming message in the current thread
      const threadId = event.data.threadId;
      if (state.chatThread.id !== threadId) break;
      const streamingMsg = state.chatThread.messages.find(
        m => m.role === "coordinator" && m.status === "streaming"
      );
      if (streamingMsg) {
        streamingMsg.text += event.data.text;
        if (state.currentView === "chat") callbacks.renderChat();
      }
      break;
    }
    case "chat-tool-start": {
      if (state.chatThread.id !== event.data.threadId) break;
      const streamMsg = state.chatThread.messages.find(
        m => m.role === "coordinator" && m.status === "streaming"
      );
      if (streamMsg) {
        if (!streamMsg.toolCalls) streamMsg.toolCalls = [];
        const tc: ChatToolCall = {
          tool: event.data.tool,
          status: "running",
          input: event.data.input,
        };
        streamMsg.toolCalls.push(tc);
        if (state.currentView === "chat") callbacks.renderChat();
      }
      break;
    }
    case "chat-tool-end": {
      if (state.chatThread.id !== event.data.threadId) break;
      const stMsg = state.chatThread.messages.find(
        m => m.role === "coordinator" && m.status === "streaming"
      );
      if (stMsg && stMsg.toolCalls) {
        // Find the last running tool with matching name
        const tc = [...stMsg.toolCalls].reverse().find(
          t => t.tool === event.data.tool && t.status === "running"
        );
        if (tc) {
          tc.status = event.data.error ? "error" : "done";
          tc.output = event.data.output;
          tc.error = event.data.error;
          tc.durationMs = event.data.durationMs;
        }
        if (state.currentView === "chat") callbacks.renderChat();
      }
      break;
    }
    case "chat-complete": {
      if (state.chatThread.id !== event.data.threadId) break;
      const completeMsg = state.chatThread.messages.find(
        m => m.role === "coordinator" && m.status === "streaming"
      );
      if (completeMsg) {
        completeMsg.status = "complete";
        completeMsg.costUsd = event.data.costUsd;
        state.chatThread.isStreaming = false;
        if (state.currentView === "chat") callbacks.renderChat();
      }
      break;
    }
    case "chat-error": {
      if (state.chatThread.id !== event.data.threadId) break;
      const errMsg = state.chatThread.messages.find(
        m => m.role === "coordinator" && m.status === "streaming"
      );
      if (errMsg) {
        errMsg.status = "error";
        errMsg.text = errMsg.text || `Error: ${event.data.error}`;
        state.chatThread.isStreaming = false;
        if (state.currentView === "chat") callbacks.renderChat();
      }
      showToast("Chat error", event.data.error, "var(--red)");
      break;
    }
  }
}
