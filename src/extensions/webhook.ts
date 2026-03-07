/**
 * Webhook Notification Extension
 *
 * Posts goal lifecycle events to external webhook URLs (Slack, Discord,
 * PagerDuty, custom HTTP endpoints). Configurable event filtering and
 * payload formatting.
 */

import type { FabricExtension, FabricEvent, GoalOutcome } from "../fabric";

export interface WebhookConfig {
  /** Webhook URL to POST to */
  url: string;
  /** Optional secret for HMAC signature verification */
  secret?: string;
  /** Which event types to send (default: all) */
  events?: string[];
  /** Only send for these outcome types (default: all) */
  outcomes?: GoalOutcome[];
  /** Custom headers to include */
  headers?: Record<string, string>;
  /** Format: "slack" for Slack-compatible blocks, "discord" for Discord embeds, "raw" for full event */
  format?: "slack" | "discord" | "raw";
}

function formatSlackPayload(event: FabricEvent): any {
  const goalId = event.goalId || "unknown";
  switch (event.type) {
    case "goal-created":
      return {
        text: `New goal created: "${event.data.title}"`,
        blocks: [
          { type: "header", text: { type: "plain_text", text: "New Goal Created" } },
          { type: "section", text: { type: "mrkdwn", text: `*${event.data.title}*\nGoal ID: \`${goalId}\`` } },
        ],
      };
    case "observability":
      return {
        text: `Goal ${event.data.outcome}: ${event.data.turnCount} turns, $${event.data.totalCost?.toFixed(2)}`,
        blocks: [
          { type: "header", text: { type: "plain_text", text: `Goal ${event.data.outcome === "success" ? "Completed" : "Finished"}` } },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Outcome:* ${event.data.outcome}` },
              { type: "mrkdwn", text: `*Turns:* ${event.data.turnCount}` },
              { type: "mrkdwn", text: `*Cost:* $${event.data.totalCost?.toFixed(2)}` },
              { type: "mrkdwn", text: `*Tool Calls:* ${event.data.toolCallCount}` },
            ],
          },
        ],
      };
    case "attention":
      return {
        text: `Attention needed: ${event.data.title}`,
        blocks: [
          { type: "header", text: { type: "plain_text", text: "Attention Required" } },
          { type: "section", text: { type: "mrkdwn", text: `*${event.data.title}*\n${event.data.body}` } },
        ],
      };
    case "retry":
      return {
        text: `Retry attempt ${event.data.attempt}/${event.data.maxRetries}: ${event.data.error}`,
      };
    default:
      return { text: `[${event.type}] ${JSON.stringify(event.data).slice(0, 200)}` };
  }
}

function formatDiscordPayload(event: FabricEvent): any {
  const colorMap: Record<string, number> = {
    "goal-created": 0x5865F2,
    "observability": 0x57F287,
    "attention": 0xFEE75C,
    "retry": 0xED4245,
  };
  return {
    embeds: [{
      title: event.type.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      description: JSON.stringify(event.data, null, 2).slice(0, 1000),
      color: colorMap[event.type] || 0x99AAB5,
      timestamp: new Date().toISOString(),
      footer: { text: `Goal: ${event.goalId || "N/A"}` },
    }],
  };
}

async function postWebhook(config: WebhookConfig, payload: any): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Fabric-Webhook/1.0",
    ...config.headers,
  };

  // HMAC signature for webhook verification
  if (config.secret) {
    const crypto = await import("crypto");
    const body = JSON.stringify(payload);
    const sig = crypto.createHmac("sha256", config.secret).update(body).digest("hex");
    headers["X-Fabric-Signature"] = `sha256=${sig}`;
  }

  try {
    const resp = await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      console.error(`Webhook ${config.url} returned ${resp.status}`);
    }
  } catch (err) {
    console.error(`Webhook ${config.url} failed:`, err);
  }
}

/**
 * Create a webhook notification extension.
 *
 * Usage:
 * ```typescript
 * engine.registerExtension(createWebhookExtension({
 *   url: "https://hooks.slack.com/services/...",
 *   format: "slack",
 *   events: ["observability", "attention"],
 * }));
 * ```
 */
export function createWebhookExtension(config: WebhookConfig): FabricExtension {
  const allowedEvents = config.events
    ? new Set(config.events)
    : null;

  return {
    name: `webhook-${new URL(config.url).hostname}`,

    onEvent: (event: FabricEvent) => {
      // Filter by event type
      if (allowedEvents && !allowedEvents.has(event.type)) return;

      // Filter by outcome (only applies to observability events)
      if (config.outcomes && event.type === "observability") {
        if (!config.outcomes.includes(event.data.outcome)) return;
      }

      // Format payload
      let payload: any;
      switch (config.format) {
        case "slack":
          payload = formatSlackPayload(event);
          break;
        case "discord":
          payload = formatDiscordPayload(event);
          break;
        default:
          payload = { event_type: event.type, goal_id: event.goalId, data: event.data, timestamp: new Date().toISOString() };
      }

      // Fire and forget (errors logged but never crash engine)
      postWebhook(config, payload);
    },

    afterGoal: async (goalId: string, outcome: GoalOutcome | undefined) => {
      if (config.outcomes && outcome && !config.outcomes.includes(outcome)) return;

      const payload = config.format === "slack"
        ? { text: `Goal \`${goalId}\` completed with outcome: *${outcome || "unknown"}*` }
        : config.format === "discord"
        ? { embeds: [{ title: "Goal Complete", description: `Goal \`${goalId}\` → ${outcome}`, color: outcome === "success" ? 0x57F287 : 0xED4245 }] }
        : { event: "goal_complete", goal_id: goalId, outcome, timestamp: new Date().toISOString() };

      await postWebhook(config, payload);
    },
  };
}
