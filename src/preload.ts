import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("agentFabric", {
  platform: process.platform,
});
