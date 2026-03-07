import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("fabric", {
  // Create a new goal from natural language
  createGoal: (description: string) =>
    ipcRenderer.invoke("fabric:create-goal", description),

  // Get all goals
  getGoals: () =>
    ipcRenderer.invoke("fabric:get-goals"),

  // Get a single goal
  getGoal: (goalId: string) =>
    ipcRenderer.invoke("fabric:get-goal", goalId),

  // Pause a goal
  pauseGoal: (goalId: string) =>
    ipcRenderer.invoke("fabric:pause-goal", goalId),

  // Resume a paused goal
  resumeGoal: (goalId: string) =>
    ipcRenderer.invoke("fabric:resume-goal", goalId),

  // Send a steering message to redirect a running goal
  steerGoal: (goalId: string, message: string) =>
    ipcRenderer.invoke("fabric:steer-goal", goalId, message),

  // Listen for real-time events from the engine
  onEvent: (callback: (event: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("fabric:event", handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener("fabric:event", handler);
  },

  // Update engine settings
  updateSettings: (settings: { apiKey?: string; model?: string; maxBudgetUsd?: number; maxTurns?: number }) =>
    ipcRenderer.invoke("fabric:update-settings", settings),
});
