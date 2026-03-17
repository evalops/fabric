/**
 * MCP Client Extension
 *
 * Connects to external MCP (Model Context Protocol) servers and bridges their
 * tools into Fabric's tool system. Each configured MCP server becomes a
 * FabricExtension with auto-discovered tools.
 *
 * Config is loaded from ~/.fabric/mcp-servers.json, following the same
 * convention as Claude Desktop.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Type } from "@mariozechner/pi-ai";
import type { TSchema } from "@sinclair/typebox";
import type { FabricExtension, FabricToolDef, FabricEvent } from "../fabric";

// ── Configuration ────────────────────────────────────

export interface McpServerConfig {
  /** Human-readable name (auto-set from config key if omitted) */
  name: string;
  /** Transport type (sse uses StreamableHTTP with automatic SSE fallback) */
  transport: "stdio" | "sse" | "streamable-http";
  /** For stdio: command to spawn */
  command?: string;
  /** For stdio: command arguments */
  args?: string[];
  /** For stdio: extra environment variables */
  env?: Record<string, string>;
  /** For sse/streamable-http: server URL */
  url?: string;
  /** For sse/streamable-http: auth/custom headers */
  headers?: Record<string, string>;
  /** Tool name prefix to avoid collisions (default: server name) */
  toolPrefix?: string;
  /** Per-tool-call timeout in ms (default: 30000) */
  toolTimeoutMs?: number;
  /** Also expose MCP resources as a read_resource tool (default: false) */
  exposeResources?: boolean;
}

// ── Schema Bridge ────────────────────────────────────

/**
 * Wrap a raw JSON Schema object as a TypeBox-compatible TSchema.
 *
 * MCP tools expose inputSchema as plain JSON Schema. Fabric's tool system
 * uses TypeBox types internally. Type.Unsafe() creates a TSchema wrapper
 * around arbitrary JSON Schema — pi-ai's Tool interface accepts TSchema,
 * so this works end-to-end without lossy conversion.
 */
function jsonSchemaToTypeBox(jsonSchema: Record<string, unknown>): TSchema {
  const schema = jsonSchema.type === "object"
    ? jsonSchema
    : { type: "object", properties: jsonSchema.properties || {}, required: jsonSchema.required || [] };
  return Type.Unsafe<Record<string, unknown>>(schema);
}

/**
 * Serialize MCP CallToolResult content to a string for FabricToolDef.execute().
 */
function serializeMcpContent(content: unknown): string {
  if (!Array.isArray(content)) return String(content);
  return content
    .map((c: Record<string, unknown>) => {
      if (c.type === "text") return (c.text as string) || "";
      if (c.type === "image") return `[Image: ${c.mimeType}]`;
      if (c.type === "resource") return `[Resource: ${(c.resource as Record<string, unknown>)?.uri || "embedded"}]`;
      return `[${c.type}]`;
    })
    .join("\n");
}

// ── Transport Factory ────────────────────────────────

function createTransport(config: McpServerConfig) {
  switch (config.transport) {
    case "stdio": {
      if (!config.command) throw new Error(`MCP "${config.name}": stdio transport requires "command"`);
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env as Record<string, string>, ...(config.env || {}) },
      });
    }
    case "sse":
    case "streamable-http": {
      if (!config.url) throw new Error(`MCP "${config.name}": streamable-http transport requires "url"`);
      return new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
      });
    }
    default:
      throw new Error(`MCP "${config.name}": unsupported transport "${config.transport}"`);
  }
}

// ── Extension Factory ────────────────────────────────

/**
 * Connect to an MCP server and return a FabricExtension exposing its tools.
 *
 * Usage:
 * ```typescript
 * const ext = await createMcpExtension({
 *   name: "filesystem",
 *   transport: "stdio",
 *   command: "npx",
 *   args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
 * });
 * engine.registerExtension(ext);
 * ```
 */
export async function createMcpExtension(config: McpServerConfig): Promise<FabricExtension & { client: Client }> {
  const client = new Client(
    { name: `fabric-${config.name}`, version: "1.0.0" },
    { capabilities: {} },
  );

  const transport = createTransport(config);
  await client.connect(transport);

  // Discover tools
  const { tools: mcpTools } = await client.listTools();
  const prefix = config.toolPrefix ?? config.name;
  const timeoutMs = config.toolTimeoutMs ?? 30_000;

  const fabricTools: FabricToolDef[] = mcpTools.map(tool => ({
    name: `${prefix}_${tool.name}`,
    description: tool.description || `MCP tool: ${tool.name}`,
    parameters: jsonSchemaToTypeBox(tool.inputSchema as Record<string, unknown>),
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const result = await client.callTool(
          { name: tool.name, arguments: args },
          undefined,
          { signal: controller.signal },
        );
        if (result.isError) {
          throw new Error(serializeMcpContent(result.content) || "MCP tool returned an error");
        }
        return serializeMcpContent(result.content);
      } finally {
        clearTimeout(timer);
      }
    },
  }));

  // Optionally expose MCP resources as a read tool
  if (config.exposeResources) {
    try {
      const { resources } = await client.listResources();
      if (resources.length > 0) {
        fabricTools.push({
          name: `${prefix}_read_resource`,
          description: `Read a resource from "${config.name}". Available: ${resources.map(r => r.uri).join(", ")}`,
          parameters: jsonSchemaToTypeBox({
            type: "object",
            properties: { uri: { type: "string", description: "The resource URI to read" } },
            required: ["uri"],
          }),
          execute: async (args: Record<string, unknown>): Promise<string> => {
            const result = await client.readResource({ uri: args.uri as string });
            return result.contents
              .map(c => ("text" in c ? c.text : "[binary content]"))
              .join("\n");
          },
        });
      }
    } catch {
      // Server doesn't support resources — that's fine
    }
  }

  // Prompt snippet listing available tools for the LLM
  const promptSnippet = [
    `MCP server "${config.name}" provides these tools:`,
    ...fabricTools.map(t => `- ${t.name}: ${t.description}`),
  ].join("\n");

  return {
    name: `mcp-${config.name}`,
    tools: fabricTools,
    promptSnippet,
    client,
    onEvent: (_event: FabricEvent) => {},
  };
}

// ── Config Loader ────────────────────────────────────

/**
 * Load MCP server configs from ~/.fabric/mcp-servers.json.
 *
 * File format (mirrors Claude Desktop convention):
 * ```json
 * {
 *   "mcpServers": {
 *     "filesystem": {
 *       "transport": "stdio",
 *       "command": "npx",
 *       "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
 *     }
 *   }
 * }
 * ```
 */
export function loadMcpConfig(configPath: string): McpServerConfig[] {
  const fs = require("fs") as typeof import("fs");
  if (!fs.existsSync(configPath)) return [];

  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const servers = (raw.mcpServers || {}) as Record<string, Omit<McpServerConfig, "name">>;

  return Object.entries(servers).map(([name, cfg]) => ({
    ...cfg,
    name,
  })) as McpServerConfig[];
}
