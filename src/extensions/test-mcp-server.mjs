#!/usr/bin/env node
/**
 * Minimal MCP server for integration testing.
 * Exposes tools over stdio transport — no external dependencies beyond the SDK.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "test-server", version: "1.0.0" });

// Simple echo tool
server.tool("echo", "Echo the input message back", { message: z.string() }, async ({ message }) => ({
  content: [{ type: "text", text: message }],
}));

// Math tool
server.tool("add", "Add two numbers", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
  content: [{ type: "text", text: String(a + b) }],
}));

// Tool that returns an error
server.tool("fail", "Always returns an error", {}, async () => ({
  content: [{ type: "text", text: "intentional failure" }],
  isError: true,
}));

// Tool with complex schema
server.tool("search", "Search with filters", {
  query: z.string().describe("Search query"),
  limit: z.number().optional().describe("Max results"),
  tags: z.array(z.string()).optional().describe("Filter tags"),
}, async ({ query, limit, tags }) => ({
  content: [{ type: "text", text: JSON.stringify({ query, limit: limit ?? 10, tags: tags ?? [] }) }],
}));

// Resource
server.resource("status", "test://status", async () => ({
  contents: [{ uri: "test://status", text: "server is running" }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
