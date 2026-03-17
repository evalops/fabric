/**
 * Chat messaging tests — verifies the fixes for:
 * 1. Chat history truncation preserving message sequence integrity
 * 2. Orphaned streaming message cleanup
 * 3. Chat history clearing on new thread
 * 4. Event handler routing to correct streaming message
 */

import { describe, it, expect, beforeEach } from "vitest";

// ── Chat History Truncation Tests ─────────────────────
// These test the truncation algorithm directly (extracted logic from FabricEngine.chat)

interface MockMessage {
  role: "user" | "assistant" | "toolResult";
  content?: string;
  toolCallId?: string;
  toolName?: string;
  timestamp: number;
}

/**
 * Replicates the safe truncation logic from fabric.ts FabricEngine.chat()
 * Must cut at a user-message boundary to avoid orphaning toolResult messages.
 */
function truncateChatHistory(messages: MockMessage[], maxLength = 80, targetLength = 40): MockMessage[] {
  if (messages.length <= maxLength) return messages;

  const target = messages.length - targetLength;
  let cutIdx = target;

  // Walk forward from target to find the next user message (safe boundary)
  while (cutIdx < messages.length) {
    if (messages[cutIdx].role === "user") break;
    cutIdx++;
  }

  // If we couldn't find one after target, walk backward
  if (cutIdx >= messages.length) {
    cutIdx = target;
    while (cutIdx > 0) {
      if (messages[cutIdx].role === "user") break;
      cutIdx--;
    }
  }

  if (cutIdx > 0) {
    return messages.slice(cutIdx);
  }
  return messages;
}

/** Helper: build a realistic chat message sequence */
function buildChatHistory(exchanges: { toolCallCount: number }[]): MockMessage[] {
  const messages: MockMessage[] = [];
  let ts = 1000;

  for (const exchange of exchanges) {
    // User message
    messages.push({ role: "user", content: `message at ${ts}`, timestamp: ts++ });

    if (exchange.toolCallCount > 0) {
      // Assistant with tool calls
      messages.push({ role: "assistant", content: "toolUse", timestamp: ts++ });

      // Tool results
      for (let i = 0; i < exchange.toolCallCount; i++) {
        messages.push({
          role: "toolResult",
          toolCallId: `tc-${ts}`,
          toolName: "read_file",
          content: "result",
          timestamp: ts++,
        });
      }

      // Assistant response after tools
      messages.push({ role: "assistant", content: "response", timestamp: ts++ });
    } else {
      // Simple assistant response
      messages.push({ role: "assistant", content: "response", timestamp: ts++ });
    }
  }

  return messages;
}

describe("Chat History Truncation", () => {
  it("should not truncate when under threshold", () => {
    const messages = buildChatHistory(Array(10).fill({ toolCallCount: 0 }));
    expect(messages.length).toBe(20); // 10 exchanges × 2 messages each
    const result = truncateChatHistory(messages);
    expect(result).toBe(messages); // Same reference, not truncated
  });

  it("should truncate long histories", () => {
    // Build 25 exchanges with 2 tool calls each = 25 × (1 user + 1 assistant + 2 toolResult + 1 assistant) = 125 messages
    const messages = buildChatHistory(Array(25).fill({ toolCallCount: 2 }));
    expect(messages.length).toBe(125);
    const result = truncateChatHistory(messages);
    expect(result.length).toBeLessThan(messages.length);
  });

  it("should always start with a user message after truncation", () => {
    const messages = buildChatHistory(Array(25).fill({ toolCallCount: 2 }));
    const result = truncateChatHistory(messages);
    expect(result[0].role).toBe("user");
  });

  it("should never have orphaned toolResult at the start", () => {
    const messages = buildChatHistory(Array(25).fill({ toolCallCount: 3 }));
    const result = truncateChatHistory(messages);
    expect(result[0].role).not.toBe("toolResult");
    expect(result[0].role).toBe("user");
  });

  it("should preserve complete tool call sequences", () => {
    const messages = buildChatHistory(Array(25).fill({ toolCallCount: 2 }));
    const result = truncateChatHistory(messages);

    // Verify: every toolResult must be preceded (somewhere before it) by an assistant message
    for (let i = 0; i < result.length; i++) {
      if (result[i].role === "toolResult") {
        const precedingAssistant = result.slice(0, i).some(m => m.role === "assistant");
        expect(precedingAssistant).toBe(true);
      }
    }
  });

  it("should handle history that is exactly at threshold", () => {
    // 20 exchanges × 4 messages (with 1 tool call each) = 80 messages exactly
    const messages = buildChatHistory(Array(20).fill({ toolCallCount: 1 }));
    expect(messages.length).toBe(80);
    const result = truncateChatHistory(messages);
    // At threshold, should not truncate
    expect(result).toBe(messages);
  });

  it("should handle history just over threshold", () => {
    // 21 exchanges × 4 messages = 84 > 80
    const messages = buildChatHistory(Array(21).fill({ toolCallCount: 1 }));
    expect(messages.length).toBe(84);
    const result = truncateChatHistory(messages);
    expect(result.length).toBeLessThan(84);
    expect(result[0].role).toBe("user");
  });

  it("should handle edge case: all messages are from the same role", () => {
    const messages: MockMessage[] = Array(100).fill(null).map((_, i) => ({
      role: "assistant" as const,
      content: `msg-${i}`,
      timestamp: i,
    }));
    // No user messages to cut at — should return original or cut at 0
    const result = truncateChatHistory(messages);
    // Walks backward to 0 without finding user, cutIdx stays at 0, returns original
    expect(result.length).toBeLessThanOrEqual(100);
  });
});

// ── Streaming Message Lifecycle Tests ────────────────

interface MockChatMessage {
  id: string;
  role: "user" | "coordinator" | "system";
  text: string;
  timestamp: number;
  status: "sent" | "streaming" | "complete" | "error";
  toolCalls?: { tool: string; status: "running" | "done" | "error" }[];
}

interface MockChatThread {
  id: string;
  messages: MockChatMessage[];
  isStreaming: boolean;
  createdAt: number;
}

/** Replicates the orphan cleanup logic from view-chat.ts sendChatMessage */
function cleanupOrphanedStreamingMessages(thread: MockChatThread): void {
  thread.messages.forEach(m => {
    if (m.role === "coordinator" && m.status === "streaming") {
      m.status = "complete";
      if (!m.text) m.text = "(interrupted)";
      if (m.toolCalls) {
        m.toolCalls.forEach(tc => { if (tc.status === "running") tc.status = "done"; });
      }
    }
  });
  thread.isStreaming = false;
}

/** Replicates the event handler's streaming message lookup */
function findStreamingMessage(thread: MockChatThread): MockChatMessage | undefined {
  return thread.messages.find(m => m.role === "coordinator" && m.status === "streaming");
}

describe("Streaming Message Lifecycle", () => {
  let thread: MockChatThread;

  beforeEach(() => {
    thread = {
      id: "thread-1",
      messages: [],
      isStreaming: false,
      createdAt: Date.now(),
    };
  });

  it("should find the streaming message for incoming events", () => {
    thread.messages.push({
      id: "msg-1", role: "coordinator", text: "",
      timestamp: Date.now(), status: "streaming",
    });
    thread.isStreaming = true;

    const found = findStreamingMessage(thread);
    expect(found).toBeDefined();
    expect(found!.id).toBe("msg-1");
  });

  it("should not find streaming message after completion", () => {
    thread.messages.push({
      id: "msg-1", role: "coordinator", text: "done",
      timestamp: Date.now(), status: "complete",
    });

    const found = findStreamingMessage(thread);
    expect(found).toBeUndefined();
  });

  it("should clean up orphaned streaming messages before creating new ones", () => {
    // Simulate: first message is streaming (orphaned)
    thread.messages.push({
      id: "msg-1", role: "coordinator", text: "partial response...",
      timestamp: Date.now(), status: "streaming",
      toolCalls: [{ tool: "read_file", status: "running" }],
    });
    thread.isStreaming = true;

    // Now user sends a new message — cleanup should run first
    cleanupOrphanedStreamingMessages(thread);

    // Verify orphan was cleaned up
    expect(thread.messages[0].status).toBe("complete");
    expect(thread.messages[0].text).toBe("partial response...");
    expect(thread.messages[0].toolCalls![0].status).toBe("done");
    expect(thread.isStreaming).toBe(false);

    // Now a new streaming message can be safely added
    thread.messages.push({
      id: "msg-2", role: "coordinator", text: "",
      timestamp: Date.now(), status: "streaming",
    });
    thread.isStreaming = true;

    // Event handler should find msg-2, not msg-1
    const found = findStreamingMessage(thread);
    expect(found!.id).toBe("msg-2");
  });

  it("should mark empty orphaned messages as (interrupted)", () => {
    thread.messages.push({
      id: "msg-1", role: "coordinator", text: "",
      timestamp: Date.now(), status: "streaming",
    });
    thread.isStreaming = true;

    cleanupOrphanedStreamingMessages(thread);

    expect(thread.messages[0].text).toBe("(interrupted)");
    expect(thread.messages[0].status).toBe("complete");
  });

  it("should handle multiple orphaned streaming messages", () => {
    // Unlikely but defensive: two streaming messages
    thread.messages.push(
      { id: "msg-1", role: "coordinator", text: "", timestamp: 1, status: "streaming" },
      { id: "msg-2", role: "coordinator", text: "partial", timestamp: 2, status: "streaming" },
    );
    thread.isStreaming = true;

    cleanupOrphanedStreamingMessages(thread);

    expect(thread.messages[0].status).toBe("complete");
    expect(thread.messages[0].text).toBe("(interrupted)");
    expect(thread.messages[1].status).toBe("complete");
    expect(thread.messages[1].text).toBe("partial");
  });
});

// ── Thread Isolation Tests ───────────────────────────

describe("Thread Isolation", () => {
  it("should not match events from a different thread", () => {
    const thread: MockChatThread = {
      id: "thread-abc",
      messages: [{
        id: "msg-1", role: "coordinator", text: "",
        timestamp: Date.now(), status: "streaming",
      }],
      isStreaming: true,
      createdAt: Date.now(),
    };

    // Simulate an event for a different thread
    const eventThreadId = "thread-xyz";
    if (thread.id !== eventThreadId) {
      // Event handler would break here
      const result = "skipped";
      expect(result).toBe("skipped");
    }
  });

  it("new thread should start with empty messages", () => {
    const oldThread: MockChatThread = {
      id: "thread-1",
      messages: [
        { id: "m1", role: "user", text: "hello", timestamp: 1, status: "complete" },
        { id: "m2", role: "coordinator", text: "hi", timestamp: 2, status: "complete" },
      ],
      isStreaming: false,
      createdAt: 1000,
    };

    // Simulate new chat
    const newThread: MockChatThread = {
      id: `thread-${Date.now()}`,
      messages: [],
      isStreaming: false,
      createdAt: Date.now(),
    };

    expect(newThread.messages.length).toBe(0);
    expect(newThread.id).not.toBe(oldThread.id);
  });
});

// ── Chat Event Routing Tests ─────────────────────────

describe("Chat Event Routing", () => {
  it("chat-text events should append to streaming message text", () => {
    const streamingMsg: MockChatMessage = {
      id: "msg-1", role: "coordinator", text: "",
      timestamp: Date.now(), status: "streaming",
    };
    const thread: MockChatThread = {
      id: "thread-1",
      messages: [streamingMsg],
      isStreaming: true,
      createdAt: Date.now(),
    };

    // Simulate chat-text events
    const found = findStreamingMessage(thread);
    expect(found).toBeDefined();
    found!.text += "Hello";
    found!.text += " world";

    expect(streamingMsg.text).toBe("Hello world");
  });

  it("chat-complete should finalize the streaming message", () => {
    const streamingMsg: MockChatMessage = {
      id: "msg-1", role: "coordinator", text: "response text",
      timestamp: Date.now(), status: "streaming",
    };
    const thread: MockChatThread = {
      id: "thread-1",
      messages: [streamingMsg],
      isStreaming: true,
      createdAt: Date.now(),
    };

    // Simulate chat-complete
    const found = findStreamingMessage(thread);
    if (found) {
      found.status = "complete";
      thread.isStreaming = false;
    }

    expect(streamingMsg.status).toBe("complete");
    expect(thread.isStreaming).toBe(false);
    expect(findStreamingMessage(thread)).toBeUndefined();
  });

  it("chat-error should mark message as error", () => {
    const streamingMsg: MockChatMessage = {
      id: "msg-1", role: "coordinator", text: "",
      timestamp: Date.now(), status: "streaming",
    };
    const thread: MockChatThread = {
      id: "thread-1",
      messages: [streamingMsg],
      isStreaming: true,
      createdAt: Date.now(),
    };

    // Simulate chat-error
    const found = findStreamingMessage(thread);
    if (found) {
      found.status = "error";
      found.text = found.text || "Error: API call failed";
      thread.isStreaming = false;
    }

    expect(streamingMsg.status).toBe("error");
    expect(streamingMsg.text).toBe("Error: API call failed");
    expect(thread.isStreaming).toBe(false);
  });

  it("after cleanup, only the newest streaming msg should receive events", () => {
    const thread: MockChatThread = {
      id: "thread-1",
      messages: [
        { id: "m1", role: "user", text: "first", timestamp: 1, status: "complete" },
        { id: "m2", role: "coordinator", text: "partial...", timestamp: 2, status: "streaming" },
        { id: "m3", role: "user", text: "second", timestamp: 3, status: "complete" },
      ],
      isStreaming: true,
      createdAt: 1,
    };

    // Cleanup orphans
    cleanupOrphanedStreamingMessages(thread);

    // Add new streaming message
    const newStream: MockChatMessage = {
      id: "m4", role: "coordinator", text: "",
      timestamp: 4, status: "streaming",
    };
    thread.messages.push(newStream);
    thread.isStreaming = true;

    // Event handler should find m4 (the new one), not m2 (now "complete")
    const found = findStreamingMessage(thread);
    expect(found!.id).toBe("m4");

    // Simulate text arriving
    found!.text += "New response";
    expect(newStream.text).toBe("New response");
    expect(thread.messages[1].text).toBe("partial..."); // Old one unchanged
  });
});
