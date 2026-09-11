import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  safeStorage,
  session,
  systemPreferences,
} from "electron";
import { readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Store, atomicWrite } from "./store";
import { CompanionRuntime } from "./runtime";
import { CredentialVault } from "./credentials";
import {
  settingsSchema,
  providerKinds,
  memoryExportSchema,
  type RuntimeEvent,
} from "../src/shared/schema";

const here = path.dirname(fileURLToPath(import.meta.url));
const devUrl = process.env.EVA_DEV_URL;
if (devUrl && devUrl !== "http://127.0.0.1:5173")
  throw new Error("Unsupported development origin");
app.setName("evangelion_project");
if (!app.isPackaged && process.env.EVA_TEST_DATA_DIR)
  app.setPath("userData", process.env.EVA_TEST_DATA_DIR);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "eva",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
let companion: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let runtime: CompanionRuntime;
let store: Store;
let vault: CredentialVault;
const providerKind = z.enum(providerKinds);
const animations = new Set([
  "idle_loop",
  "modelPose",
  "greeting",
  "peaceSign",
  "dance",
  "showFullBody",
  "shoot",
  "spin",
  "squat",
]);

function send(event: RuntimeEvent) {
  for (const win of BrowserWindow.getAllWindows())
    if (!win.isDestroyed()) win.webContents.send("eva:event", event);
}
function createWindow(mode: "companion" | "settings") {
  const avatar = mode === "companion";
  const win = new BrowserWindow({
    width: avatar ? 520 : 1180,
    height: avatar ? 820 : 820,
    minWidth: avatar ? 380 : 900,
    minHeight: 600,
    frame: !avatar,
    transparent: avatar,
    backgroundColor: avatar ? "#00000000" : "#111216",
    title: avatar ? "Eva" : "Evangelion · Settings",
    alwaysOnTop: avatar && store.data.settings.window.alwaysOnTop,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  if (devUrl) void win.loadURL(`${devUrl}/?window=${mode}`);
  else
    void win.loadFile(path.join(here, "../dist/index.html"), {
      query: { window: mode },
    });
  return win;
}
function showCompanion() {
  if (!companion) {
    companion = createWindow("companion");
    companion.on("closed", () => {
      runtime.cancel();
      companion = null;
    });
  }
  companion.show();
  companion.focus();
}
function showSettings() {
  if (!settingsWindow) {
    settingsWindow = createWindow("settings");
    settingsWindow.on("closed", () => {
      settingsWindow = null;
    });
  }
  settingsWindow.show();
  settingsWindow.focus();
}
function idle() {
  if (runtime.busy)
    throw new Error("Wait for the current reply to finish, or stop it first.");
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (store) showCompanion();
  });
  app
    .whenReady()
    .then(() => {
      const dataDirectory = app.getPath("userData");
      store = new Store(dataDirectory);
      const secure =
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== "linux" ||
          safeStorage.getSelectedStorageBackend() !== "basic_text");
      vault = new CredentialVault(dataDirectory, secure ? safeStorage : null);
      store.update((d) => {
        for (const kind of providerKinds)
          d.settings.providers[kind].hasKey = vault.has(kind);
      });
      runtime = new CompanionRuntime(
        store,
        (kind) => vault.get(kind),
        vault.mode,
        send,
      );
      const assets = app.isPackaged
        ? path.join(process.resourcesPath, "assets")
        : path.join(here, "..");
      protocol.handle("eva", async (request) => {
        const url = new URL(request.url);
        if (url.hostname !== "assets")
          return new Response("Not found", { status: 404 });
        const name = decodeURIComponent(url.pathname.slice(1));
        let file: string;
        if (name === "builtin:eva") file = path.join(assets, "Eva.vrm");
        else if (
          name.startsWith("animation:") &&
          animations.has(name.slice(10))
        )
          file = path.join(assets, "animations", `${name.slice(10)}.vrma`);
        else if (/^custom:[a-zA-Z0-9-]+$/.test(name))
          file = path.join(dataDirectory, "avatars", `${name.slice(7)}.vrm`);
        else return new Response("Not found", { status: 404 });
        try {
          const response = await net.fetch(pathToFileURL(file).href);
          response.headers.set("Access-Control-Allow-Origin", "*");
          return response;
        } catch {
          return new Response("Asset unavailable", { status: 404 });
        }
      });
      const trustedOrigin = (url: string) =>
        devUrl
          ? url.startsWith(`${devUrl}/`)
          : url.split("?")[0] ===
            pathToFileURL(path.join(here, "../dist/index.html")).href;
      session.defaultSession.setPermissionCheckHandler(
        (webContents, permission, origin) =>
          (permission === "media" || permission === "speaker-selection") &&
          !!webContents &&
          trustedOrigin(webContents.getURL()) &&
          (origin === "file://" || origin === devUrl),
      );
      session.defaultSession.setPermissionRequestHandler(
        (webContents, permission, callback, details) => {
          if (permission === "speaker-selection")
            return callback(trustedOrigin(webContents.getURL()));
          if (
            permission !== "media" ||
            !trustedOrigin(webContents.getURL()) ||
            !("mediaTypes" in details) ||
            !details.mediaTypes?.length ||
            details.mediaTypes.some((t) => t !== "audio")
          )
            return callback(false);
          if (process.platform === "darwin")
            void systemPreferences
              .askForMediaAccess("microphone")
              .then(callback);
          else callback(true);
        },
      );
      const handle = (channel: string, fn: (...args: any[]) => unknown) =>
        ipcMain.handle(`eva:${channel}`, (event, ...args) => {
          if (
            !event.senderFrame ||
            event.senderFrame !== event.sender.mainFrame ||
            !trustedOrigin(event.senderFrame.url) ||
            !BrowserWindow.fromWebContents(event.sender)
          )
            throw new Error("Untrusted caller");
          return fn(...args);
        });
      handle("snapshot", () => runtime.snapshot());
      handle("settings", (raw, rawKeys) => {
        idle();
        const settings = settingsSchema.parse(raw);
        const incoming = z
          .object({
            llm: z.string().max(2000).optional(),
            asr: z.string().max(2000).optional(),
            tts: z.string().max(2000).optional(),
            embedding: z.string().max(2000).optional(),
          })
          .strict()
          .parse(rawKeys);
        vault.save(incoming);
        for (const kind of providerKinds)
          settings.providers[kind].hasKey = vault.has(kind);
        store.settings(settings);
        companion?.setAlwaysOnTop(settings.window.alwaysOnTop);
        runtime.broadcast();
      });
      handle("send", (text) =>
        runtime.send(z.string().trim().min(1).max(8000).parse(text)),
      );
      handle("cancel", () => runtime.cancel());
      handle("transcribe", (bytes, mime) => {
        if (
          !(bytes instanceof ArrayBuffer) ||
          bytes.byteLength > 25 * 1024 * 1024 ||
          !bytes.byteLength
        )
          throw new Error("Recording must be between 1 byte and 25 MB.");
        return runtime.transcribe(
          bytes,
          z
            .enum([
              "audio/webm",
              "audio/webm;codecs=opus",
              "audio/ogg;codecs=opus",
              "audio/mp4",
              "audio/wav",
            ])
            .parse(mime),
        );
      });
      handle("speak", (text) =>
        runtime.speak(z.string().trim().min(1).max(12000).parse(text)),
      );
      handle("speech:open", (text) =>
        runtime.openSpeech(z.string().trim().min(1).max(12000).parse(text)),
      );
      handle("speech:read", (id) =>
        runtime.readSpeech(z.string().uuid().parse(id)),
      );
      handle("speech:close", (id) =>
        runtime.closeSpeech(z.string().uuid().parse(id)),
      );
      handle("models", (raw) => {
        const kind = providerKind.parse(raw);
        return runtime.provider.models(
          store.data.settings.providers[kind],
          vault.get(kind),
          kind === "embedding",
        );
      });
      handle("memory:reindex", () => runtime.reindexMemory());
      handle("test", async (raw) => {
        const kind = providerKind.parse(raw);
        const p = store.data.settings.providers[kind];
        if (kind === "embedding") {
          await runtime.provider.embed(p, vault.get(kind), [
            "A memory connection.",
          ]);
          return "Embedding generation succeeded.";
        }
        if (kind === "llm") {
          await runtime.provider.chat(
            p,
            vault.get(kind),
            [{ role: "user", content: "Reply with OK." }],
            () => {},
            undefined,
            false,
          );
          return "Chat completion succeeded.";
        }
        if (kind === "tts") {
          await runtime.speak("Hello.");
          return "Speech generation succeeded.";
        }
        // One second of silent PCM WAV exercises the actual transcription endpoint.
        const wav = Buffer.alloc(32044);
        wav.write("RIFF");
        wav.writeUInt32LE(32036, 4);
        wav.write("WAVEfmt ", 8);
        wav.writeUInt32LE(16, 16);
        wav.writeUInt16LE(1, 20);
        wav.writeUInt16LE(1, 22);
        wav.writeUInt32LE(16000, 24);
        wav.writeUInt32LE(32000, 28);
        wav.writeUInt16LE(2, 32);
        wav.writeUInt16LE(16, 34);
        wav.write("data", 36);
        wav.writeUInt32LE(32000, 40);
        try {
          await runtime.transcribe(Uint8Array.from(wav).buffer, "audio/wav");
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.message.startsWith("No speech")
          )
            throw error;
        }
        return "Transcription endpoint accepted a WAV recording.";
      });
      handle("fact:save", (raw) => {
        const input = z
          .object({
            id: z.string().optional(),
            text: z.string().trim().min(1).max(1000),
          })
          .parse(raw);
        store.update((d) => {
          const now = new Date().toISOString();
          const fact = d.facts.find(
            (f) => f.id === input.id && f.characterId === store.characterId,
          );
          if (input.id && !fact) throw new Error("Memory no longer exists.");
          if (fact) {
            fact.text = input.text;
            fact.updatedAt = now;
            fact.source = "manual";
          } else
            d.facts.push({
              id: randomUUID(),
              characterId: store.characterId,
              text: input.text,
              createdAt: now,
              updatedAt: now,
              source: "manual",
            });
        });
        runtime.broadcast();
      });
      handle("fact:delete", (raw) => {
        const id = z.string().parse(raw);
        store.update((d) => {
          d.facts = d.facts.filter(
            (f) => !(f.id === id && f.characterId === store.characterId),
          );
        });
        runtime.broadcast();
      });
      handle("session:new", () => {
        idle();
        store.update((d) => {
          d.sessions[store.characterId] = randomUUID();
        });
        runtime.broadcast();
      });
      handle("history:clear", async () => {
        idle();
        const characterId = store.characterId;
        const result = await dialog.showMessageBox({
          type: "warning",
          buttons: ["Cancel", "Delete history"],
          defaultId: 0,
          cancelId: 0,
          message: "Delete all conversation history for this character?",
          detail:
            "Saved facts are kept. Export a backup first if you want to restore these conversations.",
        });
        if (result.response !== 1) return;
        idle();
        runtime.cancel();
        store.update((d) => {
          d.messages = d.messages.filter((m) => m.characterId !== characterId);
          d.sessions[characterId] = randomUUID();
        });
        runtime.broadcast();
      });
      handle("memory:export", async () => {
        const characterId = store.characterId;
        const result = await dialog.showSaveDialog({
          defaultPath: "eva-memories.json",
          filters: [{ name: "Memory archive", extensions: ["json"] }],
        });
        if (!result.filePath) return false;
        atomicWrite(
          result.filePath,
          JSON.stringify(
            {
              version: 1,
              facts: store.data.facts.filter(
                (f) => f.characterId === characterId,
              ),
              messages: store.data.messages.filter(
                (m) => m.characterId === characterId,
              ),
            },
            null,
            2,
          ),
        );
        return true;
      });
      handle("memory:import", async () => {
        idle();
        const characterId = store.characterId;
        const result = await dialog.showOpenDialog({
          filters: [{ name: "Memory archive", extensions: ["json"] }],
          properties: ["openFile"],
        });
        if (!result.filePaths[0]) return false;
        idle();
        const bytes = readFileSync(result.filePaths[0]);
        if (bytes.byteLength > 50 * 1024 * 1024)
          throw new Error("Archive exceeds 50 MB.");
        const archive = memoryExportSchema.parse(
          JSON.parse(bytes.toString("utf8")),
        );
        store.update((d) => {
          for (const f of archive.facts)
            if (
              !d.facts.some(
                (x) => x.characterId === characterId && x.text === f.text,
              )
            )
              d.facts.push({ ...f, id: randomUUID(), characterId });
          const importedSessions = new Map<string, string>();
          for (const m of archive.messages)
            if (
              !d.messages.some(
                (x) =>
                  x.characterId === characterId &&
                  x.content === m.content &&
                  x.createdAt === m.createdAt &&
                  x.role === m.role,
              )
            ) {
              if (!importedSessions.has(m.sessionId))
                importedSessions.set(m.sessionId, randomUUID());
              d.messages.push({
                ...m,
                id: randomUUID(),
                characterId,
                sessionId: importedSessions.get(m.sessionId)!,
              });
            }
        });
        runtime.broadcast();
        return true;
      });
      handle("avatar:import", async () => {
        const result = await dialog.showOpenDialog({
          filters: [{ name: "VRM avatar", extensions: ["vrm"] }],
          properties: ["openFile"],
        });
        if (!result.filePaths[0]) return null;
        const bytes = readFileSync(result.filePaths[0]);
        if (
          bytes.length > 200 * 1024 * 1024 ||
          bytes.subarray(0, 4).toString() !== "glTF"
        )
          throw new Error("Choose a valid binary VRM file under 200 MB.");
        const id = randomUUID();
        const dir = path.join(dataDirectory, "avatars");
        mkdirSync(dir, { recursive: true });
        copyFileSync(result.filePaths[0], path.join(dir, `${id}.vrm`));
        return `custom:${id}`;
      });
      handle("window:settings", showSettings);
      handle("window:action", (raw) => {
        const action = z.enum(["minimize", "close", "companion"]).parse(raw);
        if (action === "companion") showCompanion();
        else if (action === "minimize") companion?.minimize();
        else companion?.close();
      });
      showCompanion();
      if (
        !store.data.settings.providers.llm.hasKey &&
        store.data.settings.providers.llm.baseUrl.includes("openrouter.ai")
      )
        showSettings();
      app.on("activate", showCompanion);
    })
    .catch((error) => {
      dialog.showErrorBox(
        "Could not start Evangelion",
        `${error instanceof Error ? error.message : error}\nYour data has not been reset. Check companion.json and its .bak file in the app data directory.`,
      );
      app.quit();
    });
  app.on("window-all-closed", () => {
    runtime?.cancel();
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => runtime?.cancel());
}
