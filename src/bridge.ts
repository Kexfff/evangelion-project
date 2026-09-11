import {
  defaultSettings,
  type Bridge,
  type RuntimeEvent,
  type Snapshot,
} from "./shared/schema";
declare global {
  interface Window {
    eva?: Bridge;
  }
}
// Browser mode is a UI/VRM preview. Provider requests and credentials require the desktop process.
const listeners = new Set<(event: RuntimeEvent) => void>();
const previewState: Snapshot = {
  settings: structuredClone(defaultSettings),
  facts: [],
  messages: [],
  sessionId: "preview",
  busy: false,
  secretStorage: "session-only",
};
const publish = () =>
  listeners.forEach((fn) =>
    fn({ type: "state", state: structuredClone(previewState) }),
  );
const desktopOnly = async (): Promise<never> => {
  throw new Error(
    "This is the browser preview. Run npm run dev to use voice, providers, and persistent memory in the desktop app.",
  );
};
const preview: Bridge = {
  preview: true,
  snapshot: async () => structuredClone(previewState),
  saveSettings: async (settings, keys) => {
    if (Object.values(keys).some(Boolean)) return desktopOnly();
    previewState.settings = structuredClone(settings);
    publish();
  },
  send: desktopOnly,
  cancel: async () => {},
  transcribe: desktopOnly,
  speak: desktopOnly,
  openSpeech: desktopOnly,
  readSpeech: desktopOnly,
  closeSpeech: desktopOnly,
  listModels: desktopOnly,
  reindexMemory: desktopOnly,
  testProvider: desktopOnly,
  saveFact: async (fact) => {
    const now = new Date().toISOString();
    const old = previewState.facts.find((f) => f.id === fact.id);
    if (old) {
      old.text = fact.text;
      old.updatedAt = now;
    } else
      previewState.facts.push({
        id: crypto.randomUUID(),
        text: fact.text,
        characterId: previewState.settings.activeCharacterId,
        source: "manual",
        createdAt: now,
        updatedAt: now,
      });
    publish();
  },
  deleteFact: async (id) => {
    previewState.facts = previewState.facts.filter((f) => f.id !== id);
    publish();
  },
  newSession: async () => {
    previewState.messages = [];
    publish();
  },
  clearHistory: desktopOnly,
  exportMemory: desktopOnly,
  importMemory: desktopOnly,
  importAvatar: desktopOnly,
  openSettings: async () => {
    window.location.search = "?window=settings";
  },
  windowAction: async (action) => {
    if (action === "companion") window.location.search = "?window=companion";
  },
  onEvent: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  assetUrl: (asset) =>
    asset === "builtin:eva"
      ? "/Eva.vrm"
      : `/animations/${asset.slice(10)}.vrma`,
};
export const bridge = window.eva ?? preview;
