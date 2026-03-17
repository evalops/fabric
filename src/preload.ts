import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("fabric", {
  // Create a new goal from natural language (supports model/budget overrides)
  createGoal: (descriptionOrOpts: string | { description: string; model?: string; maxBudgetUsd?: number; maxTurns?: number }) =>
    ipcRenderer.invoke("fabric:create-goal", descriptionOrOpts),

  // Create a batch of goals
  createBatchGoals: (descriptions: string[], opts?: { model?: string; maxBudgetUsd?: number; maxTurns?: number }) =>
    ipcRenderer.invoke("fabric:create-batch-goals", descriptions, opts),

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

  // Send a chat message to the coordinator
  chat: (text: string, threadId: string) =>
    ipcRenderer.invoke("fabric:chat", text, threadId),

  // Clear chat history (start fresh thread)
  clearChat: () =>
    ipcRenderer.invoke("fabric:clear-chat"),

  // Cancel an active goal
  cancelGoal: (goalId: string) =>
    ipcRenderer.invoke("fabric:pause-goal", goalId),

  // Listen for real-time events from the engine
  onEvent: (callback: (event: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("fabric:event", handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener("fabric:event", handler);
  },

  // Get available models from pi-ai catalog
  getModels: () =>
    ipcRenderer.invoke("fabric:get-models"),

  // Resolve a HITL attention question (human responds to agent)
  resolveAttention: (questionId: string, response: string) =>
    ipcRenderer.invoke("fabric:resolve-attention", questionId, response),

  // Read a file for download/preview
  readFile: (filePath: string) =>
    ipcRenderer.invoke("fabric:read-file", filePath),

  // Update engine settings
  updateSettings: (settings: { apiKey?: string; model?: string; maxBudgetUsd?: number; maxTurns?: number; provider?: string }) =>
    ipcRenderer.invoke("fabric:update-settings", settings),

  // Get connected MCP servers
  getMcpServers: () =>
    ipcRenderer.invoke("fabric:get-mcp-servers"),
});
