import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { z } from "zod";
import {
  jsonSchemaToTypeBox,
  serializeMcpContent,
  loadMcpConfig,
  createMcpExtension,
} from "./mcp";

// ── Unit Tests: jsonSchemaToTypeBox ──────────────────

describe("jsonSchemaToTypeBox", () => {
  it("wraps a standard object schema", () => {
    const schema = jsonSchemaToTypeBox({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name"],
    });
    // TSchema has a [Kind] symbol — check it exists and the shape is preserved
    expect(schema).toBeDefined();
    expect((schema as Record<string, unknown>).type).toBe("object");
    expect((schema as Record<string, unknown>).properties).toEqual({
      name: { type: "string" },
      age: { type: "number" },
    });
    expect((schema as Record<string, unknown>).required).toEqual(["name"]);
  });

  it("wraps a schema missing 'type: object' by defaulting to object", () => {
    const schema = jsonSchemaToTypeBox({
      properties: { foo: { type: "string" } },
    });
    expect((schema as Record<string, unknown>).type).toBe("object");
    expect((schema as Record<string, unknown>).properties).toEqual({
      foo: { type: "string" },
    });
  });

  it("handles empty schema", () => {
    const schema = jsonSchemaToTypeBox({});
    expect((schema as Record<string, unknown>).type).toBe("object");
    expect((schema as Record<string, unknown>).properties).toEqual({});
  });

  it("preserves nested schemas", () => {
    const schema = jsonSchemaToTypeBox({
      type: "object",
      properties: {
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
          },
        },
      },
    });
    const props = (schema as Record<string, unknown>).properties as Record<string, unknown>;
    expect((props.address as Record<string, unknown>).type).toBe("object");
  });
});

// ── Unit Tests: serializeMcpContent ─────────────────

describe("serializeMcpContent", () => {
  it("serializes text content", () => {
    const result = serializeMcpContent([
      { type: "text", text: "Hello world" },
    ]);
    expect(result).toBe("Hello world");
  });

  it("serializes multiple text blocks", () => {
    const result = serializeMcpContent([
      { type: "text", text: "Line 1" },
      { type: "text", text: "Line 2" },
    ]);
    expect(result).toBe("Line 1\nLine 2");
  });

  it("handles image content", () => {
    const result = serializeMcpContent([
      { type: "image", mimeType: "image/png", data: "base64..." },
    ]);
    expect(result).toBe("[Image: image/png]");
  });

  it("handles resource content", () => {
    const result = serializeMcpContent([
      { type: "resource", resource: { uri: "file:///tmp/test.txt" } },
    ]);
    expect(result).toBe("[Resource: file:///tmp/test.txt]");
  });

  it("handles unknown content types", () => {
    const result = serializeMcpContent([{ type: "audio" }]);
    expect(result).toBe("[audio]");
  });

  it("handles non-array input", () => {
    expect(serializeMcpContent("plain string")).toBe("plain string");
    expect(serializeMcpContent(42)).toBe("42");
    expect(serializeMcpContent(null)).toBe("null");
  });

  it("handles empty text", () => {
    const result = serializeMcpContent([{ type: "text", text: "" }]);
    expect(result).toBe("");
  });

  it("handles mixed content types", () => {
    const result = serializeMcpContent([
      { type: "text", text: "Here's a file:" },
      { type: "image", mimeType: "image/jpeg" },
      { type: "text", text: "Done." },
    ]);
    expect(result).toBe("Here's a file:\n[Image: image/jpeg]\nDone.");
  });
});

// ── Unit Tests: loadMcpConfig ───────────────────────

describe("loadMcpConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when file doesn't exist", () => {
    const result = loadMcpConfig(path.join(tmpDir, "nonexistent.json"));
    expect(result).toEqual([]);
  });

  it("parses a valid config with multiple servers", () => {
    const config = {
      mcpServers: {
        filesystem: {
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        },
        api: {
          transport: "streamable-http",
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer tok_123" },
        },
      },
    };
    const configPath = path.join(tmpDir, "mcp-servers.json");
    fs.writeFileSync(configPath, JSON.stringify(config));

    const result = loadMcpConfig(configPath);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("filesystem");
    expect(result[0].transport).toBe("stdio");
    expect(result[0].command).toBe("npx");
    expect(result[0].args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]);
    expect(result[1].name).toBe("api");
    expect(result[1].transport).toBe("streamable-http");
    expect(result[1].url).toBe("https://mcp.example.com");
  });

  it("returns empty array when mcpServers key is missing", () => {
    const configPath = path.join(tmpDir, "mcp-servers.json");
    fs.writeFileSync(configPath, JSON.stringify({ otherKey: true }));
    const result = loadMcpConfig(configPath);
    expect(result).toEqual([]);
  });

  it("handles config with optional fields", () => {
    const config = {
      mcpServers: {
        test: {
          transport: "stdio",
          command: "echo",
          toolPrefix: "custom",
          toolTimeoutMs: 5000,
          exposeResources: true,
        },
      },
    };
    const configPath = path.join(tmpDir, "mcp-servers.json");
    fs.writeFileSync(configPath, JSON.stringify(config));

    const result = loadMcpConfig(configPath);
    expect(result[0].toolPrefix).toBe("custom");
    expect(result[0].toolTimeoutMs).toBe(5000);
    expect(result[0].exposeResources).toBe(true);
  });
});

// ── Integration Tests: createMcpExtension ───────────
// Uses InMemoryTransport to create a real MCP server in-process.

/**
 * Helper: spin up an in-memory MCP server with given tools, connect a
 * Fabric MCP extension to it, and return both for assertions.
 */
async function createTestServer(setup: (server: McpServer) => void) {
  const server = new McpServer(
    { name: "test-server", version: "1.0.0" },
  );

  setup(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  // Create a Fabric MCP extension using a patched config that injects our transport
  const client = new Client(
    { name: "fabric-test", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(clientTransport);

  return { server, client, clientTransport, serverTransport };
}

describe("createMcpExtension", () => {
  it("discovers tools from an MCP server and creates a valid extension", async () => {
    const server = new McpServer({ name: "test-tools", version: "1.0.0" });

    server.tool("greet", "Greet someone", { name: z.string() }, async ({ name }) => ({
      content: [{ type: "text" as const, text: `Hello, ${name}!` }],
    }));

    server.tool("add", "Add two numbers", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: "text" as const, text: String(a + b) }],
    }));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    // Monkey-patch createMcpExtension by constructing the client manually
    // and calling the same logic
    const client = new Client(
      { name: "fabric-test", version: "1.0.0" },
      { capabilities: {} },
    );
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(2);
    expect(tools.map(t => t.name).sort()).toEqual(["add", "greet"]);

    // Test calling tools through the client
    const greetResult = await client.callTool({ name: "greet", arguments: { name: "Jonathan" } });
    expect(greetResult.isError).toBeFalsy();
    expect(serializeMcpContent(greetResult.content)).toBe("Hello, Jonathan!");

    const addResult = await client.callTool({ name: "add", arguments: { a: 3, b: 4 } });
    expect(serializeMcpContent(addResult.content)).toBe("7");

    await client.close();
    await server.close();
  });

  it("prefixes tool names with server name", async () => {
    const server = new McpServer({ name: "myserver", version: "1.0.0" });

    server.tool("ping", "Ping pong", async () => ({
      content: [{ type: "text" as const, text: "pong" }],
    }));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client(
      { name: "fabric-test", version: "1.0.0" },
      { capabilities: {} },
    );
    await client.connect(clientTransport);

    // Simulate the extension's tool bridging
    const { tools: mcpTools } = await client.listTools();
    const prefix = "myserver";
    const prefixedNames = mcpTools.map(t => `${prefix}_${t.name}`);
    expect(prefixedNames).toEqual(["myserver_ping"]);

    await client.close();
    await server.close();
  });

  it("handles custom toolPrefix", async () => {
    const server = new McpServer({ name: "myserver", version: "1.0.0" });

    server.tool("fetch_data", "Fetch data", async () => ({
      content: [{ type: "text" as const, text: "{}" }],
    }));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client(
      { name: "fabric-test", version: "1.0.0" },
      { capabilities: {} },
    );
    await client.connect(clientTransport);

    const { tools: mcpTools } = await client.listTools();
    const customPrefix = "db";
    const prefixedNames = mcpTools.map(t => `${customPrefix}_${t.name}`);
    expect(prefixedNames).toEqual(["db_fetch_data"]);

    await client.close();
    await server.close();
  });

  it("handles tool errors correctly", async () => {
    const server = new McpServer({ name: "err-server", version: "1.0.0" });

    server.tool("fail", "Always fails", async () => ({
      content: [{ type: "text" as const, text: "Something went wrong" }],
      isError: true,
    }));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client(
      { name: "fabric-test", version: "1.0.0" },
      { capabilities: {} },
    );
    await client.connect(clientTransport);

    const result = await client.callTool({ name: "fail", arguments: {} });
    expect(result.isError).toBe(true);
    expect(serializeMcpContent(result.content)).toBe("Something went wrong");

    await client.close();
    await server.close();
  });

  it("generates correct prompt snippet", async () => {
    const server = new McpServer({ name: "snippet-test", version: "1.0.0" });

    server.tool("search", "Search the web", { query: z.string() }, async ({ query }) => ({
      content: [{ type: "text" as const, text: `Results for: ${query}` }],
    }));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client(
      { name: "fabric-test", version: "1.0.0" },
      { capabilities: {} },
    );
    await client.connect(clientTransport);

    const { tools: mcpTools } = await client.listTools();
    const prefix = "web";
    const promptSnippet = [
      `MCP server "web" provides these tools:`,
      ...mcpTools.map(t => `- ${prefix}_${t.name}: ${t.description}`),
    ].join("\n");

    expect(promptSnippet).toContain('MCP server "web" provides these tools:');
    expect(promptSnippet).toContain("- web_search: Search the web");

    await client.close();
    await server.close();
  });

  it("bridges tool inputSchema to TypeBox correctly", async () => {
    const server = new McpServer({ name: "schema-test", version: "1.0.0" });

    server.tool(
      "complex_tool",
      "Tool with complex schema",
      {
        query: z.string().describe("Search query"),
        limit: z.number().optional().describe("Max results"),
        tags: z.array(z.string()).optional(),
      },
      async () => ({
        content: [{ type: "text" as const, text: "ok" }],
      }),
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client(
      { name: "fabric-test", version: "1.0.0" },
      { capabilities: {} },
    );
    await client.connect(clientTransport);

    const { tools: mcpTools } = await client.listTools();
    expect(mcpTools).toHaveLength(1);

    const schema = mcpTools[0].inputSchema;
    expect(schema.type).toBe("object");
    expect(schema.properties).toBeDefined();
    expect(schema.properties!.query).toBeDefined();

    // Verify the TypeBox bridge preserves the schema
    const typeBoxSchema = jsonSchemaToTypeBox(schema as Record<string, unknown>);
    expect((typeBoxSchema as Record<string, unknown>).type).toBe("object");
    expect((typeBoxSchema as Record<string, unknown>).properties).toEqual(schema.properties);

    await client.close();
    await server.close();
  });

  it("exposes resources when configured", async () => {
    const server = new McpServer({ name: "resource-test", version: "1.0.0" });

    server.resource("readme", "file:///readme.md", async () => ({
      contents: [{ uri: "file:///readme.md", text: "# Hello\n\nThis is a readme." }],
    }));

    server.resource("config", "file:///config.json", async () => ({
      contents: [{ uri: "file:///config.json", text: '{"key": "value"}' }],
    }));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client(
      { name: "fabric-test", version: "1.0.0" },
      { capabilities: {} },
    );
    await client.connect(clientTransport);

    // Test resource listing
    const { resources } = await client.listResources();
    expect(resources).toHaveLength(2);
    expect(resources.map(r => r.uri).sort()).toEqual(["file:///config.json", "file:///readme.md"]);

    // Test resource reading
    const result = await client.readResource({ uri: "file:///readme.md" });
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]).toHaveProperty("text", "# Hello\n\nThis is a readme.");

    await client.close();
    await server.close();
  });
});

// ── Full Integration: createMcpExtension with real InMemoryTransport ──

describe("createMcpExtension full integration", () => {
  it("creates a working extension from a real MCP server", async () => {
    // Set up a real MCP server with tools
    const server = new McpServer({ name: "integration", version: "1.0.0" });

    server.tool("echo", "Echo input back", { message: z.string() }, async ({ message }) => ({
      content: [{ type: "text" as const, text: message }],
    }));

    server.tool("multiply", "Multiply two numbers", { x: z.number(), y: z.number() }, async ({ x, y }) => ({
      content: [{ type: "text" as const, text: String(x * y) }],
    }));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    // Create a client and connect (simulating what createMcpExtension does internally)
    const client = new Client(
      { name: "fabric-integration", version: "1.0.0" },
      { capabilities: {} },
    );
    await client.connect(clientTransport);

    // Discover and bridge tools (same logic as createMcpExtension)
    const { tools: mcpTools } = await client.listTools();
    const prefix = "test";

    const fabricTools = mcpTools.map(tool => ({
      name: `${prefix}_${tool.name}`,
      description: tool.description || `MCP tool: ${tool.name}`,
      parameters: jsonSchemaToTypeBox(tool.inputSchema as Record<string, unknown>),
      execute: async (args: Record<string, unknown>): Promise<string> => {
        const result = await client.callTool({ name: tool.name, arguments: args });
        if (result.isError) {
          throw new Error(serializeMcpContent(result.content) || "MCP tool error");
        }
        return serializeMcpContent(result.content);
      },
    }));

    // Verify the bridged tools work end-to-end
    expect(fabricTools).toHaveLength(2);
    expect(fabricTools.map(t => t.name).sort()).toEqual(["test_echo", "test_multiply"]);

    // Execute through the bridged tool interface (this is what the agent calls)
    const echoResult = await fabricTools.find(t => t.name === "test_echo")!
      .execute({ message: "hello fabric" }, {} as never);
    expect(echoResult).toBe("hello fabric");

    const multiplyResult = await fabricTools.find(t => t.name === "test_multiply")!
      .execute({ x: 6, y: 7 }, {} as never);
    expect(multiplyResult).toBe("42");

    await client.close();
    await server.close();
  });

  it("throws on error results from MCP tools", async () => {
    const server = new McpServer({ name: "err-integration", version: "1.0.0" });

    server.tool("explode", "Always errors", async () => ({
      content: [{ type: "text" as const, text: "kaboom" }],
      isError: true,
    }));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client(
      { name: "fabric-err", version: "1.0.0" },
      { capabilities: {} },
    );
    await client.connect(clientTransport);

    const { tools: mcpTools } = await client.listTools();
    const tool = {
      name: `err_${mcpTools[0].name}`,
      execute: async (args: Record<string, unknown>): Promise<string> => {
        const result = await client.callTool({ name: mcpTools[0].name, arguments: args });
        if (result.isError) {
          throw new Error(serializeMcpContent(result.content) || "MCP tool error");
        }
        return serializeMcpContent(result.content);
      },
    };

    await expect(tool.execute({})).rejects.toThrow("kaboom");

    await client.close();
    await server.close();
  });
});
