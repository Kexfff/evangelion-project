import { contextBridge, ipcRenderer } from "electron";
import type { Bridge, RuntimeEvent } from "../src/shared/schema";
const api: Bridge = {
  submitGameGoal: (input) => ipcRenderer.invoke("eva:game:submit", input),
  controlGameGoal: (id, action) =>
    ipcRenderer.invoke("eva:game:control", { id, action }),
  configureGameGoals: (config) =>
    ipcRenderer.invoke("eva:game:configure", config),
  configureMinecraft: (config) =>
    ipcRenderer.invoke("eva:minecraft:configure", config),
  minecraftAction: (action) =>
    ipcRenderer.invoke("eva:minecraft:action", action),
  saveLandmark: (name) => ipcRenderer.invoke("eva:minecraft:landmark", name),
  deleteLandmark: (id) =>
    ipcRenderer.invoke("eva:minecraft:delete-landmark", id),
  configureMcp: (config, secrets) =>
    ipcRenderer.invoke("eva:mcp:configure", config, secrets),
  mcpAction: (id, action) => ipcRenderer.invoke("eva:mcp:action", id, action),
  mcpGrant: (id, tool, fingerprint, policy) =>
    ipcRenderer.invoke("eva:mcp:grant", id, tool, fingerprint, policy),
  mcpApproval: (id, allow) => ipcRenderer.invoke("eva:mcp:approval", id, allow),
  stopTools: () => ipcRenderer.invoke("eva:mcp:stop"),
  listHistory: (query) => ipcRenderer.invoke("eva:history:list", query),
  readConversation: (query) => ipcRenderer.invoke("eva:history:read", query),
  readHistoryImage: (query) => ipcRenderer.invoke("eva:history:image", query),
  pluginAction: (action) => ipcRenderer.invoke("eva:plugin:action", action),
  configureTelegram: (config, token) =>
    ipcRenderer.invoke("eva:plugin:telegram", config, token),
  snapshot: () => ipcRenderer.invoke("eva:snapshot"),
  saveSettings: (settings, keys) =>
    ipcRenderer.invoke("eva:settings", settings, keys),
  send: (text, images) => ipcRenderer.invoke("eva:send", text, images),
  cancel: () => ipcRenderer.invoke("eva:cancel"),
  presence: (state) => ipcRenderer.invoke("eva:presence", state),
  setAutonomyPaused: (paused) =>
    ipcRenderer.invoke("eva:autonomy:pause", paused),
  setBehavior: (levels) => ipcRenderer.invoke("eva:autonomy:state", levels),
  createTask: (task) => ipcRenderer.invoke("eva:task:create", task),
  taskAction: (id, action) => ipcRenderer.invoke("eva:task:action", id, action),
  transcribe: (bytes, mime) =>
    ipcRenderer.invoke("eva:transcribe", bytes, mime),
  speak: (text) => ipcRenderer.invoke("eva:speak", text),
  openSpeech: (text) => ipcRenderer.invoke("eva:speech:open", text),
  readSpeech: (id) => ipcRenderer.invoke("eva:speech:read", id),
  closeSpeech: (id) => ipcRenderer.invoke("eva:speech:close", id),
  listModels: (kind) => ipcRenderer.invoke("eva:models", kind),
  listOpenRouterProviders: (model) =>
    ipcRenderer.invoke("eva:openrouter:providers", model),
  reindexMemory: () => ipcRenderer.invoke("eva:memory:reindex"),
  testProvider: (kind) => ipcRenderer.invoke("eva:test", kind),
  saveFact: (fact) => ipcRenderer.invoke("eva:fact:save", fact),
  deleteFact: (id) => ipcRenderer.invoke("eva:fact:delete", id),
  newSession: () => ipcRenderer.invoke("eva:session:new"),
  clearHistory: () => ipcRenderer.invoke("eva:history:clear"),
  exportMemory: () => ipcRenderer.invoke("eva:memory:export"),
  importMemory: () => ipcRenderer.invoke("eva:memory:import"),
  importAvatar: () => ipcRenderer.invoke("eva:avatar:import"),
  openSettings: () => ipcRenderer.invoke("eva:window:settings"),
  windowAction: (action) => ipcRenderer.invoke("eva:window:action", action),
  onEvent: (listener) => {
    const handler = (_: Electron.IpcRendererEvent, event: RuntimeEvent) =>
      listener(event);
    ipcRenderer.on("eva:event", handler);
    return () => {
      ipcRenderer.removeListener("eva:event", handler);
    };
  },
  assetUrl: (asset) => `eva://assets/${encodeURIComponent(asset)}`,
};
contextBridge.exposeInMainWorld("eva", api);
