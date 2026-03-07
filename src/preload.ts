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

  // Listen for real-time events from the engine
  onEvent: (callback: (event: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("fabric:event", handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener("fabric:event", handler);
  },
});
