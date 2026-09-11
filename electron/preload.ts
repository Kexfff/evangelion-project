import { contextBridge, ipcRenderer } from "electron";
import type { Bridge, RuntimeEvent } from "../src/shared/schema";
const api: Bridge = {
  snapshot: () => ipcRenderer.invoke("eva:snapshot"),
  saveSettings: (settings, keys) =>
    ipcRenderer.invoke("eva:settings", settings, keys),
  send: (text, images) => ipcRenderer.invoke("eva:send", text, images),
  cancel: () => ipcRenderer.invoke("eva:cancel"),
  transcribe: (bytes, mime) =>
    ipcRenderer.invoke("eva:transcribe", bytes, mime),
  speak: (text) => ipcRenderer.invoke("eva:speak", text),
  openSpeech: (text) => ipcRenderer.invoke("eva:speech:open", text),
  readSpeech: (id) => ipcRenderer.invoke("eva:speech:read", id),
  closeSpeech: (id) => ipcRenderer.invoke("eva:speech:close", id),
  listModels: (kind) => ipcRenderer.invoke("eva:models", kind),
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
