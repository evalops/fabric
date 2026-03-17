/**
 * End-to-end test for the MCP client extension using real stdio transport.
 *
 * Spawns test-mcp-server.mjs as a child process and connects to it via
 * StdioClientTransport — the same path that production uses. Tests the
 * full pipeline: spawn → connect → discover tools → execute → serialize.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as path from "path";
import { createMcpExtension, serializeMcpContent } from "./mcp";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

const TEST_SERVER = path.join(__dirname, "test-mcp-server.mjs");

describe("MCP stdio end-to-end", () => {
  let client: Client | undefined;

  afterEach(async () => {
    if (client) {
      try { await client.close(); } catch { /* best-effort */ }
      client = undefined;
    }
  });

  it("connects to a real stdio MCP server and discovers tools", async () => {
    const ext = await createMcpExtension({
      name: "e2e-test",
      transport: "stdio",
      command: "node",
      args: [TEST_SERVER],
    });
    client = ext.client;

    expect(ext.name).toBe("mcp-e2e-test");
    expect(ext.tools).toBeDefined();
    expect(ext.tools!.length).toBeGreaterThanOrEqual(4);

    const toolNames = ext.tools!.map(t => t.name);
    expect(toolNames).toContain("e2e-test_echo");
    expect(toolNames).toContain("e2e-test_add");
    expect(toolNames).toContain("e2e-test_fail");
    expect(toolNames).toContain("e2e-test_search");
  });

  it("executes echo tool through the full pipeline", async () => {
    const ext = await createMcpExtension({
      name: "e2e",
      transport: "stdio",
      command: "node",
      args: [TEST_SERVER],
    });
    client = ext.client;

    const echoTool = ext.tools!.find(t => t.name === "e2e_echo")!;
    const result = await echoTool.execute({ message: "hello from fabric" }, {} as never);
    expect(result).toBe("hello from fabric");
  });

  it("executes add tool and gets correct result", async () => {
    const ext = await createMcpExtension({
      name: "e2e",
      transport: "stdio",
      command: "node",
      args: [TEST_SERVER],
    });
    client = ext.client;

    const addTool = ext.tools!.find(t => t.name === "e2e_add")!;
    const result = await addTool.execute({ a: 17, b: 25 }, {} as never);
    expect(result).toBe("42");
  });

  it("handles error results from tools", async () => {
    const ext = await createMcpExtension({
      name: "e2e",
      transport: "stdio",
      command: "node",
      args: [TEST_SERVER],
    });
    client = ext.client;

    const failTool = ext.tools!.find(t => t.name === "e2e_fail")!;
    await expect(failTool.execute({}, {} as never)).rejects.toThrow("intentional failure");
  });

  it("executes tool with complex schema", async () => {
    const ext = await createMcpExtension({
      name: "e2e",
      transport: "stdio",
      command: "node",
      args: [TEST_SERVER],
    });
    client = ext.client;

    const searchTool = ext.tools!.find(t => t.name === "e2e_search")!;
    const result = await searchTool.execute(
      { query: "fabric mcp", limit: 5, tags: ["ai", "tools"] },
      {} as never,
    );
    const parsed = JSON.parse(result);
    expect(parsed.query).toBe("fabric mcp");
    expect(parsed.limit).toBe(5);
    expect(parsed.tags).toEqual(["ai", "tools"]);
  });

  it("uses custom toolPrefix", async () => {
    const ext = await createMcpExtension({
      name: "e2e",
      transport: "stdio",
      command: "node",
      args: [TEST_SERVER],
      toolPrefix: "myprefix",
    });
    client = ext.client;

    const toolNames = ext.tools!.map(t => t.name);
    expect(toolNames.every(n => n.startsWith("myprefix_"))).toBe(true);
    expect(toolNames).toContain("myprefix_echo");
  });

  it("generates prompt snippet with all tools listed", async () => {
    const ext = await createMcpExtension({
      name: "e2e",
      transport: "stdio",
      command: "node",
      args: [TEST_SERVER],
    });
    client = ext.client;

    expect(ext.promptSnippet).toContain('MCP server "e2e" provides these tools:');
    expect(ext.promptSnippet).toContain("e2e_echo");
    expect(ext.promptSnippet).toContain("e2e_add");
    expect(ext.promptSnippet).toContain("e2e_search");
  });

  it("exposes resources when configured", async () => {
    const ext = await createMcpExtension({
      name: "e2e",
      transport: "stdio",
      command: "node",
      args: [TEST_SERVER],
      exposeResources: true,
    });
    client = ext.client;

    const resourceTool = ext.tools!.find(t => t.name === "e2e_read_resource");
    expect(resourceTool).toBeDefined();
    expect(resourceTool!.description).toContain("test://status");

    const result = await resourceTool!.execute({ uri: "test://status" }, {} as never);
    expect(result).toBe("server is running");
  });

  it("throws on invalid stdio command", async () => {
    await expect(
      createMcpExtension({
        name: "bad",
        transport: "stdio",
        command: "nonexistent-binary-that-does-not-exist",
        args: [],
      }),
    ).rejects.toThrow();
  });

  it("returns a valid FabricExtension shape", async () => {
    const ext = await createMcpExtension({
      name: "e2e",
      transport: "stdio",
      command: "node",
      args: [TEST_SERVER],
    });
    client = ext.client;

    // Check FabricExtension interface compliance
    expect(ext.name).toBeTypeOf("string");
    expect(ext.tools).toBeInstanceOf(Array);
    expect(ext.promptSnippet).toBeTypeOf("string");
    expect(ext.onEvent).toBeTypeOf("function");
    expect(ext.client).toBeDefined();

    // Each tool has the FabricToolDef shape
    for (const tool of ext.tools!) {
      expect(tool.name).toBeTypeOf("string");
      expect(tool.description).toBeTypeOf("string");
      expect(tool.parameters).toBeDefined();
      expect(tool.execute).toBeTypeOf("function");
    }
  });
});
