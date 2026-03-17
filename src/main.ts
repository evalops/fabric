import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { FabricEngine } from "./fabric";
import type { FabricEvent } from "./fabric";
import { createMcpExtension, loadMcpConfig } from "./extensions/mcp";

// Load .env file from project root
function loadEnv(): void {
  try {
    const envPath = path.join(__dirname, "..", ".env");
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && val && !process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch { /* .env loading is best-effort */ }
}

loadEnv();

let mainWindow: BrowserWindow | null = null;
const engine = new FabricEngine();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "Fabric",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// ── IPC Handlers ──────────────────────────────────────

// Create a new goal from natural language (supports model/budget overrides)
ipcMain.handle("fabric:create-goal", async (_event, descriptionOrOpts: any) => {
  try {
    const goalId = await engine.createGoal(descriptionOrOpts);
    return { success: true, goalId };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// Create a batch of goals
ipcMain.handle("fabric:create-batch-goals", async (_event, descriptions: string[], opts?: { model?: string; maxBudgetUsd?: number; maxTurns?: number }) => {
  try {
    const result = await engine.createBatchGoals(descriptions, opts as any);
    return { success: true, ...result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// Get all goals
ipcMain.handle("fabric:get-goals", async () => {
  return engine.getGoals();
});

// Get a single goal
ipcMain.handle("fabric:get-goal", async (_event, goalId: string) => {
  return engine.getGoal(goalId);
});

// Pause a goal
ipcMain.handle("fabric:pause-goal", async (_event, goalId: string) => {
  engine.pauseGoal(goalId);
  return { success: true };
});

// Resume a paused goal
ipcMain.handle("fabric:resume-goal", async (_event, goalId: string) => {
  try {
    await engine.resumeGoal(goalId);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// Send a steering message to redirect a running goal
ipcMain.handle("fabric:steer-goal", async (_event, goalId: string, message: string) => {
  engine.sendSteeringMessage(goalId, message);
  return { success: true };
});

// Send a chat message to the coordinator
ipcMain.handle("fabric:chat", async (_event, text: string, threadId: string) => {
  try {
    // chat() streams responses via events — don't await the full completion
    engine.chat(text, threadId).catch(err => {
      console.error("Chat error:", err);
    });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// Update engine settings from renderer
ipcMain.handle("fabric:update-settings", async (_event, settings: { apiKey?: string; model?: string; maxBudgetUsd?: number; maxTurns?: number; provider?: string }) => {
  // Set API keys based on provider
  if (settings.apiKey !== undefined) {
    const provider = settings.provider || "anthropic";
    const envMap: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
    };
    const envVar = envMap[provider] || "ANTHROPIC_API_KEY";
    process.env[envVar] = settings.apiKey;
  }
  engine.updateSettings(settings);
  return { success: true };
});

// Get available models from the engine (populated from pi-ai catalog)
ipcMain.handle("fabric:get-models", async () => {
  return engine.getAvailableModels();
});

// Resolve a HITL attention question
ipcMain.handle("fabric:resolve-attention", async (_event, questionId: string, response: string) => {
  const resolved = engine.resolveAttention(questionId, response);
  return { success: resolved };
});

// Read a file's contents for download/preview
ipcMain.handle("fabric:read-file", async (_event, filePath: string) => {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const stat = fs.statSync(filePath);
    return { success: true, content, sizeBytes: stat.size, name: path.basename(filePath) };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// ── MCP Server Management ─────────────────────────────

const MCP_CONFIG_PATH = path.join(os.homedir(), ".fabric", "mcp-servers.json");
const mcpClients: { name: string; client: import("@modelcontextprotocol/sdk/client/index.js").Client }[] = [];

async function loadMcpServers(): Promise<void> {
  const configs = loadMcpConfig(MCP_CONFIG_PATH);
  if (configs.length === 0) return;

  for (const config of configs) {
    try {
      const ext = await createMcpExtension(config);
      engine.registerExtension(ext);
      mcpClients.push({ name: config.name, client: ext.client });
      console.log(`MCP: "${config.name}" connected (${ext.tools?.length || 0} tools)`);
    } catch (err) {
      console.error(`MCP: "${config.name}" failed to connect:`, err);
    }
  }
}

ipcMain.handle("fabric:get-mcp-servers", async () => {
  return mcpClients.map(m => m.name);
});

// ── Forward engine events to renderer ─────────────────

engine.on("fabric-event", (event: FabricEvent) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("fabric:event", event);
  }
});

// ── App Lifecycle ─────────────────────────────────────

app.whenReady().then(async () => {
  await loadMcpServers();
  createWindow();
});

app.on("before-quit", async () => {
  for (const { client } of mcpClients) {
    try { await client.close(); } catch { /* best-effort cleanup */ }
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
