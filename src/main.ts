import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { FabricEngine } from "./fabric";
import type { FabricEvent } from "./fabric";

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

// Create a new goal from natural language
ipcMain.handle("fabric:create-goal", async (_event, description: string) => {
  try {
    const goalId = await engine.createGoal(description);
    return { success: true, goalId };
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

// Send a steering message to redirect a running goal
ipcMain.handle("fabric:steer-goal", async (_event, goalId: string, message: string) => {
  engine.sendSteeringMessage(goalId, message);
  return { success: true };
});

// Update engine settings from renderer
ipcMain.handle("fabric:update-settings", async (_event, settings: { apiKey?: string; model?: string; maxBudgetUsd?: number; maxTurns?: number }) => {
  if (settings.apiKey !== undefined) process.env.ANTHROPIC_API_KEY = settings.apiKey;
  engine.updateSettings(settings);
  return { success: true };
});

// ── Forward engine events to renderer ─────────────────

engine.on("fabric-event", (event: FabricEvent) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("fabric:event", event);
  }
});

// ── App Lifecycle ─────────────────────────────────────

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
