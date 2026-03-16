import { state, bridge, callbacks } from './state';
import { escapeHtml, relativeTime, renderThinkingBlock } from './utils';
import type { ChatMessage, ChatToolCall } from './types';

// ── Tool rendering infrastructure ─────────────────────

const TOOL_META: Record<string, { icon: string; color: string; category: string }> = {
  Read:     { icon: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 2h7l3 3v9H3V2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 2v3h3" stroke="currentColor" stroke-width="1.5"/></svg>`, color: "var(--blue)", category: "file" },
  Grep:     { icon: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M10 10l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`, color: "var(--green)", category: "search" },
  Glob:     { icon: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4h4l1.5 2H14v7H2V4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`, color: "var(--green)", category: "search" },
  Edit:     { icon: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`, color: "var(--accent)", category: "write" },
  Write:    { icon: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`, color: "var(--accent)", category: "write" },
  Bash:     { icon: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M4 7l2.5 2L4 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 11h3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`, color: "var(--amber)", category: "shell" },
  WebFetch: { icon: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M2 8h12M8 2c-2 2-2 10 0 12M8 2c2 2 2 10 0 12" stroke="currentColor" stroke-width="1.2"/></svg>`, color: "#8250df", category: "network" },
  LSP:      { icon: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 12h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`, color: "#0a7b83", category: "lang" },
};

// ── Language badge labels for fenced code blocks ──────
const LANG_LABELS: Record<string, string> = {
  js: "JavaScript", javascript: "JavaScript", ts: "TypeScript", typescript: "TypeScript",
  py: "Python", python: "Python", rb: "Ruby", ruby: "Ruby", go: "Go", rust: "Rust",
  java: "Java", cpp: "C++", c: "C", cs: "C#", csharp: "C#", swift: "Swift",
  kotlin: "Kotlin", php: "PHP", sql: "SQL", sh: "Shell", bash: "Bash", zsh: "Shell",
  yaml: "YAML", yml: "YAML", json: "JSON", toml: "TOML", xml: "XML", html: "HTML",
  css: "CSS", scss: "SCSS", md: "Markdown", dockerfile: "Dockerfile", makefile: "Makefile",
};

/**
 * Markdown renderer: fenced code blocks with copy + lang badge, **bold**, `inline code`,
 * lists, blockquotes, headers, links, and hr dividers. Pre-escapes HTML for safety.
 */
function renderMarkdown(text: string): string {
  // First, extract fenced code blocks before escaping (they need special handling)
  const codeBlocks: string[] = [];
  const withPlaceholders = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const idx = codeBlocks.length;
    const langLabel = LANG_LABELS[lang.toLowerCase()] || lang || "";
    const langBadge = langLabel ? `<span class="chat-code-lang">${escapeHtml(langLabel)}</span>` : "";
    const escapedCode = escapeHtml(code.replace(/\n$/, "")); // trim trailing newline
    codeBlocks.push(
      `<div class="chat-code-block">`
      + `<div class="chat-code-header">${langBadge}<button class="chat-code-copy" data-code-idx="${idx}" title="Copy code"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" stroke-width="1.5"/></svg></button></div>`
      + `<pre><code>${escapedCode}</code></pre>`
      + `</div>`
    );
    return `\x00CODEBLOCK_${idx}\x00`;
  });

  // Now escape the rest and apply inline markdown
  let html = escapeHtml(withPlaceholders)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<div class="chat-md-h3">$1</div>')
    .replace(/^## (.+)$/gm, '<div class="chat-md-h2">$1</div>')
    .replace(/^# (.+)$/gm, '<div class="chat-md-h1">$1</div>')
    .replace(/^&gt; (.+)$/gm, '<div class="chat-md-blockquote">$1</div>')
    .replace(/^- (.+)$/gm, '<span class="chat-md-li">\u2022 $1</span>')
    .replace(/^(\d+)\. (.+)$/gm, '<span class="chat-md-li">$1. $2</span>')
    .replace(/^---$/gm, '<hr class="chat-md-hr">');

  // Restore code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    html = html.replace(`\x00CODEBLOCK_${i}\x00`, codeBlocks[i]);
  }
  return html;
}

function getToolMeta(tool: string): { icon: string; color: string; category: string } {
  return TOOL_META[tool] || { icon: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="1.5"/></svg>`, color: "var(--text-muted)", category: "other" };
}

function formatToolDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function renderToolCallCards(calls: ChatToolCall[]): string {
  if (!calls || calls.length === 0) return "";
  return `<div class="chat-tools">${calls.map((tc, i) => {
    const meta = getToolMeta(tc.tool);
    const statusIcon = tc.status === "running"
      ? `<span class="chat-tool-spinner"></span>`
      : tc.status === "error"
        ? `<span class="chat-tool-status-icon error">!</span>`
        : `<span class="chat-tool-status-icon done">\u2713</span>`;
    const duration = tc.durationMs != null && tc.status !== "running"
      ? `<span class="chat-tool-dur">${formatToolDuration(tc.durationMs)}</span>`
      : "";
    const inputLine = tc.input
      ? `<span class="chat-tool-input">${escapeHtml(tc.input)}</span>`
      : "";
    const errorLine = tc.error
      ? `<div class="chat-tool-error">${escapeHtml(tc.error)}</div>`
      : "";
    const outputLine = tc.output
      ? `<div class="chat-tool-output">${escapeHtml(tc.output)}</div>`
      : "";
    const detail = (tc.output || tc.error)
      ? `<div class="chat-tool-detail">${outputLine}${errorLine}</div>`
      : "";

    return `<div class="chat-tool-card${tc.status === "error" ? " errored" : ""}${tc.status === "running" ? " running" : ""}" data-tool-idx="${i}" style="--tool-color: ${meta.color}">
      <div class="chat-tool-head">
        <span class="chat-tool-icon" style="color: ${meta.color}">${meta.icon}</span>
        <span class="chat-tool-name">${tc.tool}</span>
        ${inputLine}
        <span class="chat-tool-right">${duration}${statusIcon}</span>
      </div>
      ${detail}
    </div>`;
  }).join("")}</div>`;
}

let autoScroll = true;
let scrollCleanup: (() => void) | null = null;
/** Stop the current streaming response. */
export function stopStreaming(): void {
  if (!state.chatThread.isStreaming) return;
  // Finalize the streaming message
  const streamMsg = state.chatThread.messages.find(
    m => m.role === "coordinator" && m.status === "streaming"
  );
  if (streamMsg) {
    streamMsg.status = "complete";
    // Mark any running tools as done
    if (streamMsg.toolCalls) {
      streamMsg.toolCalls.forEach(tc => {
        if (tc.status === "running") tc.status = "done";
      });
    }
    if (!streamMsg.text) streamMsg.text = "(stopped)";
  }
  state.chatThread.isStreaming = false;
  renderChat();
}

function renderMessage(msg: ChatMessage): string {
  if (msg.role === "system") {
    return `<div class="chat-system">${msg.text}</div>`;
  }

  if (msg.role === "user") {
    const ts = new Date(msg.timestamp);
    const exact = `${ts.getHours().toString().padStart(2, "0")}:${ts.getMinutes().toString().padStart(2, "0")}`;
    return `
      <div class="chat-row chat-row-user">
        <div class="chat-bubble chat-bubble-user">
          <div class="chat-bubble-text">${escapeHtml(msg.text)}</div>
          <div class="chat-bubble-user-time" title="${ts.toLocaleString()}">${exact}</div>
        </div>
      </div>
    `;
  }

  // Coordinator message
  const agentLabel = msg.agentSource
    ? `<span class="chat-agent-source">via ${escapeHtml(msg.agentSource)}</span>`
    : "";
  const thinkingHtml = msg.thinking
    ? renderThinkingBlock("coordinator", msg.thinking, msg.timestamp, true)
    : "";
  const actionsHtml = msg.actions && msg.actions.length > 0
    ? `<div class="chat-actions">${msg.actions.map(a =>
        `<button class="btn ${a.style === "primary" ? "btn-primary" : a.style === "danger" ? "btn-danger" : ""}" data-action-id="${a.actionId}">${escapeHtml(a.label)}</button>`
      ).join("")}</div>`
    : "";
  const toolsHtml = msg.toolCalls && msg.toolCalls.length > 0
    ? renderToolCallCards(msg.toolCalls) + (msg.costUsd ? `<div class="chat-tool-cost">$${msg.costUsd.toFixed(2)}</div>` : "")
    : "";
  const goalChip = msg.goalId
    ? `<span class="chat-goal-chip" data-goal="${msg.goalId}">${state.goals.find(g => g.id === msg.goalId)?.title || msg.goalId} \u2192</span>`
    : "";
  const streamingIndicator = msg.status === "streaming"
    ? `<span class="chat-typing"><span></span><span></span><span></span></span>`
    : "";
  // Copy button (only on complete messages with text)
  const copyBtn = msg.status === "complete" && msg.text
    ? `<button class="chat-msg-copy" data-msg-id="${msg.id}" title="Copy message"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" stroke-width="1.5"/></svg></button>`
    : "";
  // Retry button on errors
  const retryBtn = msg.status === "error"
    ? `<button class="chat-msg-retry" data-msg-id="${msg.id}" title="Retry">Retry</button>`
    : "";

  return `
    <div class="chat-row chat-row-coordinator${msg.status === "error" ? " error" : ""}" data-msg-id="${msg.id}">
      <div class="chat-avatar">F</div>
      <div class="chat-bubble chat-bubble-coordinator">
        <div class="chat-bubble-header">
          <span class="chat-bubble-name">Fabric</span>
          ${agentLabel}
          <span class="chat-bubble-time">${relativeTime(msg.timestamp)}</span>
          ${copyBtn}
        </div>
        ${thinkingHtml}
        ${toolsHtml}
        <div class="chat-bubble-text">${renderMarkdown(msg.text)}${streamingIndicator}</div>
        ${goalChip}
        ${actionsHtml}
        ${retryBtn}
      </div>
    </div>
  `;
}

function renderEmptyState(): string {
  const working = state.agents.filter(a => a.status === "working").length;
  const totalAgents = state.agents.length;
  const suggestions = [
    { text: "What's the status of all active goals?", icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11" r="0.75" fill="currentColor"/></svg>` },
    { text: "Deploy the latest build to staging", icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3M3 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>` },
    { text: "Run a security audit on all dependencies", icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5L2.5 4v4c0 3.5 2.5 5.5 5.5 6.5 3-1 5.5-3 5.5-6.5V4L8 1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>` },
  ];

  return `
    <div class="chat-empty">
      <div class="chat-empty-icon"><svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" stroke="var(--border-lit)" stroke-width="2"/><circle cx="24" cy="20" r="6" stroke="var(--text-muted)" stroke-width="2"/><path d="M12 38c0-6.63 5.37-12 12-12s12 5.37 12 12" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round"/></svg></div>
      <div class="chat-empty-title">What should we work on?</div>
      <div class="chat-empty-sub">${working} of ${totalAgents} agents active &middot; Ready to coordinate</div>
      <div class="chat-suggestions">
        ${suggestions.map(s => `
          <div class="chat-suggestion" data-text="${escapeHtml(s.text)}">
            <span class="chat-suggestion-icon">${s.icon}</span>
            <span>${escapeHtml(s.text)}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

export function renderChat(): void {
  const feed = document.getElementById("feed")!;
  const thread = state.chatThread;

  if (thread.messages.length === 0) {
    feed.innerHTML = `
      ${renderEmptyState()}
      ${renderChatInput()}
    `;
  } else {
    feed.innerHTML = `
      <div class="chat-messages" id="chat-messages">
        ${thread.messages.map(renderMessage).join("")}
      </div>
      ${renderChatInput()}
    `;
  }

  // Auto-scroll to bottom
  const messagesEl = document.getElementById("chat-messages");
  if (messagesEl && autoScroll) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Track scroll position for auto-scroll (clean up previous listener to avoid leaks)
  if (scrollCleanup) scrollCleanup();
  if (messagesEl) {
    const onScroll = () => {
      const atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 40;
      autoScroll = atBottom;
    };
    messagesEl.addEventListener("scroll", onScroll);
    scrollCleanup = () => messagesEl.removeEventListener("scroll", onScroll);
  }

  // Wire chat input
  const input = document.getElementById("chat-input") as HTMLTextAreaElement | null;
  const sendBtn = document.getElementById("chat-send");
  if (input && sendBtn) {
    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      input.style.height = "auto";
      sendChatMessage(text);
    };
    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    // Auto-resize textarea
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 150) + "px";
    });
    // Focus input on view switch
    input.focus();
  }

  // Wire suggestion cards
  feed.querySelectorAll(".chat-suggestion").forEach(el => {
    el.addEventListener("click", () => {
      const text = (el as HTMLElement).dataset.text!;
      sendChatMessage(text);
    });
  });

  // Wire goal chips
  feed.querySelectorAll(".chat-goal-chip").forEach(el => {
    el.addEventListener("click", () => {
      const goalId = (el as HTMLElement).dataset.goal;
      if (goalId) callbacks.openGoalDetail(goalId);
    });
  });

  // Wire action buttons
  feed.querySelectorAll(".chat-actions .btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const actionId = (btn as HTMLElement).dataset.actionId!;
      handleChatAction(actionId, btn as HTMLElement);
    });
  });

  // Wire thinking block toggles
  feed.querySelectorAll(".thinking-header").forEach(header => {
    header.addEventListener("click", () => {
      header.closest(".thinking-block")!.classList.toggle("collapsed");
    });
  });

  // Wire tool card expand/collapse
  feed.querySelectorAll(".chat-tool-card").forEach(card => {
    const detail = card.querySelector(".chat-tool-detail");
    if (detail) {
      card.querySelector(".chat-tool-head")!.addEventListener("click", () => {
        card.classList.toggle("expanded");
      });
    }
  });

  // Wire code block copy buttons
  feed.querySelectorAll(".chat-code-copy").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const block = btn.closest(".chat-code-block");
      const code = block?.querySelector("code")?.textContent || "";
      navigator.clipboard.writeText(code).then(() => {
        btn.classList.add("copied");
        setTimeout(() => btn.classList.remove("copied"), 1500);
      });
    });
  });

  // Wire message copy buttons
  feed.querySelectorAll(".chat-msg-copy").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const msgId = (btn as HTMLElement).dataset.msgId;
      const msg = state.chatThread.messages.find(m => m.id === msgId);
      if (msg) {
        navigator.clipboard.writeText(msg.text).then(() => {
          btn.classList.add("copied");
          setTimeout(() => btn.classList.remove("copied"), 1500);
        });
      }
    });
  });

  // Wire retry buttons (on error messages)
  feed.querySelectorAll(".chat-msg-retry").forEach(btn => {
    btn.addEventListener("click", () => {
      const msgId = (btn as HTMLElement).dataset.msgId;
      // Find the user message that preceded this error
      const idx = state.chatThread.messages.findIndex(m => m.id === msgId);
      if (idx > 0) {
        const userMsg = state.chatThread.messages[idx - 1];
        if (userMsg.role === "user") {
          // Remove the error message and retry
          state.chatThread.messages.splice(idx, 1);
          sendChatMessage(userMsg.text);
          return; // sendChatMessage will re-render
        }
      }
    });
  });

  // Wire stop generation button
  const stopBtn = document.getElementById("chat-stop");
  if (stopBtn) {
    stopBtn.addEventListener("click", () => stopStreaming());
  }

  // Wire new chat button
  const newChatBtn = document.getElementById("chat-new-thread");
  if (newChatBtn) {
    newChatBtn.addEventListener("click", () => {
      // Archive current thread
      if (state.chatThread.messages.length > 0) {
        state.chatThreads.push({ ...state.chatThread });
      }
      // Start fresh thread
      state.chatThread = {
        id: `thread-${Date.now()}`,
        messages: [],
        isStreaming: false,
        createdAt: Date.now(),
      };
      autoScroll = true;
      renderChat();
    });
  }
}

function renderChatInput(): string {
  const isStreaming = state.chatThread.isStreaming;
  const sendOrStop = isStreaming
    ? `<button id="chat-stop" class="chat-stop-btn" title="Stop generating (Esc)">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor"/></svg>
      </button>`
    : `<button id="chat-send" class="chat-send-btn" title="Send (Enter)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M14 8L2 2l2.5 6L2 14l12-6z" fill="currentColor"/></svg>
      </button>`;
  return `
    <div class="chat-input-area">
      <div class="chat-input-wrap${isStreaming ? " streaming" : ""}">
        <textarea id="chat-input" class="chat-input" placeholder="${isStreaming ? "Waiting for response..." : "Ask Fabric anything, or describe a goal..."}" rows="1" spellcheck="false" ${isStreaming ? "disabled" : ""}></textarea>
        ${sendOrStop}
      </div>
      <div class="chat-input-footer">
        <span class="chat-input-model">${state.settings.model || "sonnet-4"}</span>
        <span class="chat-input-hint">${state.chatThread.messages.length > 0 ? `<button id="chat-new-thread" class="chat-new-btn" title="New chat">New chat</button>` : ""}<kbd>${isStreaming ? "Esc" : "Cmd+K"}</kbd> ${isStreaming ? "stop" : "commands"}</span>
      </div>
    </div>
  `;
}

function handleChatAction(actionId: string, _btnEl: HTMLElement): void {
  const msg = state.chatThread.messages.find(m =>
    m.actions?.some(a => a.actionId === actionId)
  );
  const action = msg?.actions?.find(a => a.actionId === actionId);
  if (!action) return;

  // Remove actions from message (one-shot)
  if (msg) msg.actions = undefined;

  // Send the action label as a user message through the normal chat flow
  sendChatMessage(action.label);
}

export function sendChatMessage(text: string): void {
  // Add user message
  appendMessage({
    id: `msg-${Date.now()}`,
    role: "user",
    text,
    timestamp: Date.now(),
    status: "complete",
  });

  autoScroll = true;
  renderChat();

  // Create streaming placeholder for coordinator response
  state.chatThread.isStreaming = true;
  const streamMsg: ChatMessage = {
    id: `msg-${Date.now() + 1}`,
    role: "coordinator",
    text: "",
    timestamp: Date.now(),
    status: "streaming",
  };
  state.chatThread.messages.push(streamMsg);
  renderChat();

  if (bridge) {
    // ── Real mode: send to engine, events update streamMsg via event-handler.ts ──
    bridge.chat(text, state.chatThread.id).then(result => {
      if (!result.success) {
        streamMsg.status = "error";
        streamMsg.text = `Error: ${result.error || "Failed to send message"}`;
        state.chatThread.isStreaming = false;
        renderChat();
      }
      // Otherwise, chat-text / chat-tool-start / chat-tool-end / chat-complete
      // events will stream in via event-handler.ts and update streamMsg
    });
  }
}

function appendMessage(msg: ChatMessage): void {
  state.chatThread.messages.push(msg);
  state.activityLog.unshift({
    time: msg.timestamp,
    text: msg.role === "user"
      ? `<strong>you</strong> said: "${msg.text.slice(0, 60)}${msg.text.length > 60 ? "..." : ""}"`
      : msg.text.slice(0, 80),
  });
}

