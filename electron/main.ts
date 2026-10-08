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
  powerMonitor,
} from "electron";
import { readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Store, atomicWrite } from "./store";
import { configureTestProfile } from "./test-profile";
import { PttService } from "./ptt-service";
import { bindPortalShortcut } from "./ptt-portal";
import {
  historyQuerySchema,
  conversationQuerySchema,
  historyImageQuerySchema,
  assertHistoryCharacter,
  listHistory,
  readConversation,
  readHistoryImage,
} from "../src/shared/history";
import { CompanionRuntime } from "./runtime";
import { CredentialVault } from "./credentials";
import { PluginHost } from "./plugin-host";
import { minecraftFactory } from "./minecraft-transport";
import { MINECRAFT_ID, minecraftConfigSchema } from "../src/shared/minecraft";
import {
  gameGoalConfigSchema,
  goalInputSchema,
  goalControlSchema,
} from "../src/shared/game-goals";
import { telegramSettingsSchema } from "../src/shared/plugins";
import {
  mcpConfigSchema,
  mcpSecretsSchema,
  mcpIdSchema,
  toolPolicySchema,
} from "../src/shared/mcp";
import { outgoingMessageSchema } from "../src/shared/images";
import {
  presenceSchema,
  levelsSchema,
  taskInputSchema,
} from "../src/shared/autonomy";
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
configureTestProfile(app, process.env.EVA_TEST_DATA_DIR);
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
let plugins: PluginHost;
let ptt: PttService;
let microphoneOwner: { sender: number; id: string } | undefined;
let voiceIndicator: BrowserWindow | null = null;
let voiceIndicatorPhase = "idle";
function showVoiceActivity(phase: "idle" | "listening" | "transcribing") {
  if (phase === voiceIndicatorPhase) return;
  voiceIndicatorPhase = phase;
  if (phase === "idle") {
    voiceIndicator?.destroy();
    voiceIndicator = null;
    return;
  }
  if (!voiceIndicator) {
    voiceIndicator = new BrowserWindow({
      width: 280,
      height: 64,
      frame: false,
      resizable: false,
      focusable: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: "#191b24",
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    voiceIndicator.setIgnoreMouseEvents(true);
  }
  const indicator = voiceIndicator;
  const label =
    phase === "listening" ? "● Eva is listening" : "◌ Transcribing…";
  void indicator
    .loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><body style="margin:12px 18px;color:#f7e3f1;background:#191b24;font:15px system-ui"><strong>${label}</strong><div style="font-size:11px;opacity:.65;margin-top:4px">Press-to-talk · maximum 60 seconds</div></body>`)}`,
    )
    .then(() => {
      if (!indicator.isDestroyed()) indicator.showInactive();
    })
    .catch(() => {});
}
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
      backgroundThrottling: !avatar,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  const releaseCapture = () => {
    if (microphoneOwner?.sender === win.webContents.id)
      microphoneOwner = undefined;
    if (avatar) {
      ptt?.cancel();
      showVoiceActivity("idle");
    } else if (ptt?.status.testing) ptt.test(false);
  };
  win.webContents.on("render-process-gone", releaseCapture);
  win.webContents.on("did-start-loading", releaseCapture);
  win.on("close", releaseCapture);
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
      ptt = new PttService(
        bindPortalShortcut,
        (action) => {
          if (action === "cancel") showVoiceActivity("idle");
          if (companion && !companion.isDestroyed())
            companion.webContents.send("eva:event", {
              type: "ptt-action",
              action,
            });
          if (
            action === "cancel" &&
            settingsWindow &&
            !settingsWindow.isDestroyed()
          )
            settingsWindow.webContents.send("eva:event", {
              type: "ptt-action",
              action,
            });
        },
        (status) => send({ type: "ptt-status", status }),
      );
      plugins = new PluginHost(
        runtime,
        vault,
        undefined,
        minecraftFactory(path.join(here, "minecraft-worker.cjs")),
      );
      void plugins.start();
      const assets = app.isPackaged
        ? path.join(process.resourcesPath, "assets")
        : path.join(here, "..");
      protocol.handle("eva", async (request) => {
        const url = new URL(request.url);
        if (url.hostname !== "assets")
          return new Response("Not found", { status: 404 });
        const name = decodeURIComponent(url.pathname.slice(1));
        let file: string;
        if (name === "builtin:eva")
          file = path.join(assets, "AvatarSample_B.vrm");
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
      handle("ptt:status", () => ptt.status);
      handle("ptt:test", (raw) => ptt.test(z.boolean().parse(raw)));
      handle("ptt:retry", () => {
        void ptt.configure(store.data.settings.voice.ptt, true);
      });
      handle("ptt:settled", () => ptt.settled());
      ipcMain.handle("eva:microphone:lease", (event, rawId, rawAcquire) => {
        if (
          event.senderFrame !== event.sender.mainFrame ||
          !trustedOrigin(event.sender.getURL()) ||
          ![companion?.webContents, settingsWindow?.webContents].includes(
            event.sender,
          )
        )
          throw new Error("Untrusted caller");
        const id = z.string().uuid().parse(rawId);
        const acquire = z.boolean().parse(rawAcquire);
        if (!acquire) {
          if (
            microphoneOwner?.sender === event.sender.id &&
            microphoneOwner.id === id
          )
            microphoneOwner = undefined;
          return true;
        }
        if (
          microphoneOwner &&
          (microphoneOwner.sender !== event.sender.id ||
            microphoneOwner.id !== id)
        )
          return false;
        microphoneOwner = { sender: event.sender.id, id };
        return true;
      });
      ipcMain.handle("eva:voice:activity", (event, raw) => {
        if (
          event.sender !== companion?.webContents ||
          event.senderFrame !== event.sender.mainFrame ||
          !trustedOrigin(event.sender.getURL())
        )
          throw new Error("Companion only");
        const phase = z.enum(["idle", "listening", "transcribing"]).parse(raw);
        showVoiceActivity(
          store.data.settings.voice.ptt.enabled &&
            store.data.settings.voice.ptt.scope === "global"
            ? phase
            : "idle",
        );
      });
      handle("game:autonomy:configure", (raw) =>
        plugins.game.configureAutonomy(raw),
      );
      handle("game:autonomy:pause", (raw) =>
        plugins.game.pauseAutonomy(z.boolean().parse(raw)),
      );
      handle("game:submit", (raw) =>
        plugins.game.submit(goalInputSchema.parse(raw), {
          characterId: store.characterId,
          sessionId: store.sessionId,
          channel: "desktop",
        }),
      );
      handle("game:control", (raw) =>
        plugins.game.control(goalControlSchema.parse(raw)),
      );
      handle("game:project", (raw) => plugins.game.saveProject(raw));
      handle("game:configure", (raw) => {
        const config = gameGoalConfigSchema.parse(raw);
        plugins.game.pauseAll(
          "Game goal settings changed. Resume explicitly to continue.",
        );
        store.update((d) => {
          d.minecraft.goalConfig = config;
        });
        runtime.broadcast();
      });
      handle("minecraft:configure", (raw) =>
        plugins.exclusive(() =>
          plugins.minecraft.configure(
            minecraftConfigSchema.parse(raw),
            plugins.mcp,
          ),
        ),
      );
      handle("minecraft:action", (raw) => {
        const action = z.enum(["connect", "disconnect", "stop"]).parse(raw);
        if (action === "stop") {
          plugins.minecraft.stopAction();
          return;
        }
        return plugins.exclusive(async () => {
          if (action === "connect") {
            if (!plugins.minecraft.enabled)
              throw new Error(
                "Enable the Minecraft plugin before joining a world.",
              );
            const c = store.data.minecraft.config;
            const result = await dialog.showMessageBox({
              type: "question",
              title: "Join Minecraft world?",
              message: `Join ${c.host}:${c.port} as ${c.username}?`,
              detail: `Only join a world you own or have permission to use. Java ${c.version}, ${c.auth} authentication. Minecraft actions are allowed unless explicitly blocked, including mining, building, terrain navigation and requested public game chat. Optional limits and your tool blocks still apply. Operator coordinate lookup: ${c.operatorLookup ? "on" : "off"}. No automatic replay of game actions.`,
              buttons: ["Cancel", "Join world"],
              defaultId: 0,
              cancelId: 0,
            });
            if (result.response !== 1) return;
          }
          await plugins.mcp.action(MINECRAFT_ID, action);
        });
      });
      handle("minecraft:landmark", (name) =>
        plugins.minecraft.saveLandmark(
          z.string().trim().min(1).max(80).parse(name),
        ),
      );
      handle("minecraft:enabled", (enabled) =>
        plugins.exclusive(() =>
          plugins.minecraft.setEnabled(z.boolean().parse(enabled), plugins.mcp),
        ),
      );
      handle("minecraft:delete-landmark", (id) =>
        plugins.minecraft.deleteLandmark(z.string().uuid().parse(id)),
      );
      handle("mcp:configure", (config, secrets) =>
        plugins.exclusive(() => {
          if (config?.id === MINECRAFT_ID)
            throw new Error("Use Minecraft settings for the bundled adapter.");
          return plugins.mcp.configure(
            mcpConfigSchema.parse(config),
            mcpSecretsSchema.optional().parse(secrets),
          );
        }),
      );
      handle("mcp:action", (rawId, rawAction) =>
        plugins.exclusive(async () => {
          const id = mcpIdSchema.parse(rawId);
          if (id === MINECRAFT_ID)
            throw new Error("Use Minecraft controls for the bundled adapter.");
          const action = z
            .enum(["connect", "disconnect", "remove"])
            .parse(rawAction);
          if (action === "connect") {
            const config = store.data.mcp.servers.find(
              (s) => s.config.id === id,
            )?.config;
            if (!config) throw new Error("Unknown MCP connection.");
            const answer = await dialog.showMessageBox({
              type: "warning",
              title: "Trust this MCP server?",
              message: `Connect to ${config.name}?`,
              detail:
                config.transport === "stdio"
                  ? `This runs a local program with your OS account's access. It is NOT sandboxed. Only run software you trust.\n\nExecutable: ${config.command}\nArguments: ${JSON.stringify(config.args)}\n\nThe connection will start automatically with the app until disconnected. Tool grants are configured separately.`
                  : `This contacts ${config.url} and sends its saved bearer token, if any. Only connect to a service you trust. Enabled tools may receive conversation-derived arguments.\n\nThe connection will start automatically with the app until disconnected. Tool grants are configured separately.`,
              buttons: ["Cancel", "Trust and connect"],
              defaultId: 0,
              cancelId: 0,
            });
            if (answer.response !== 1) return;
          }
          await plugins.mcp.action(id, action);
        }),
      );
      handle("mcp:grant", (id, tool, fingerprint, policy) => {
        if (id === MINECRAFT_ID) plugins.minecraft.stopAction();
        plugins.mcp.grant(
          mcpIdSchema.parse(id),
          z.string().min(1).max(128).parse(tool),
          z.string().length(64).parse(fingerprint),
          toolPolicySchema.parse(policy),
        );
        if (id === MINECRAFT_ID) plugins.minecraft.refreshPermissions();
      });
      handle("mcp:approval", (id, allow) =>
        plugins.mcp.approve(
          z.string().uuid().parse(id),
          z.boolean().parse(allow),
        ),
      );
      handle("mcp:stop", async () => {
        plugins.game.cancelAll();
        await Promise.all([plugins.mcp.emergencyStop(), runtime.cancel()]);
      });
      handle("history:list", (raw) => {
        const query = historyQuerySchema.parse(raw);
        assertHistoryCharacter(query.characterId, store.characterId);
        return listHistory(store.data.messages, store.sessionId, query);
      });
      handle("history:read", (raw) => {
        const query = conversationQuerySchema.parse(raw);
        assertHistoryCharacter(query.characterId, store.characterId);
        return readConversation(store.data.messages, query);
      });
      handle("history:image", (raw) => {
        const query = historyImageQuerySchema.parse(raw);
        assertHistoryCharacter(query.characterId, store.characterId);
        return readHistoryImage(store.data.messages, query);
      });
      handle("plugin:action", (action) =>
        plugins.action(
          z
            .enum([
              "install",
              "update",
              "remove",
              "disable",
              "unpair",
              "pair",
              "restart",
            ])
            .parse(action),
        ),
      );
      handle("plugin:telegram", (config, token) =>
        plugins.configure(
          telegramSettingsSchema.parse(config),
          z.string().max(150).optional().parse(token),
        ),
      );
      handle("settings", async (raw, rawKeys) =>
        plugins.withPaused(async () => {
          // Settings changes invalidate autonomous decisions, including a switch-off.
          if (runtime.snapshot().busy) await runtime.cancel();
          idle();
          const settings = settingsSchema.parse(raw);
          ptt.cancel();
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
          void ptt.configure(settings.voice.ptt);
        }),
      );
      handle("send", (text, images) => {
        const message = outgoingMessageSchema.parse({ text, images });
        return runtime.send(message.text, message.images);
      });
      handle("cancel", () => runtime.cancel());
      ipcMain.handle("eva:presence", (event, raw) => {
        if (
          !companion ||
          event.sender !== companion.webContents ||
          event.senderFrame !== event.sender.mainFrame ||
          !trustedOrigin(event.senderFrame!.url)
        )
          throw new Error("Only the companion may report playback presence.");
        runtime.autonomy.setPresence({
          ...presenceSchema.parse(raw),
          visible:
            companion.isVisible() &&
            !companion.isMinimized() &&
            presenceSchema.parse(raw).visible,
        });
      });
      handle("autonomy:pause", (paused) =>
        runtime.pauseAutonomy(z.boolean().parse(paused)),
      );
      handle("autonomy:state", (levels) =>
        runtime.autonomy.setBehavior(levelsSchema.parse(levels)),
      );
      handle("task:create", (task) => {
        runtime.autonomy.createTask(taskInputSchema.parse(task));
      });
      handle("task:action", (id, action) =>
        runtime.taskAction(
          z.string().uuid().parse(id),
          z.enum(["approve", "cancel"]).parse(action),
        ),
      );
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
      handle("openrouter:providers", (model) =>
        runtime.provider.openRouterProviders(z.string().max(200).parse(model)),
      );
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
        plugins.minecraft.stopAction();
        store.update((d) => {
          d.sessions[store.characterId] = randomUUID();
        });
        runtime.events.emit({
          type: "session:started",
          characterId: store.characterId,
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
                  JSON.stringify(x.images ?? []) ===
                    JSON.stringify(m.images ?? []) &&
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
      void ptt.configure(store.data.settings.voice.ptt);
      const scheduler = setInterval(() => {
        void runtime.autonomy.tick().catch(() =>
          send({
            type: "warning",
            message:
              "Autonomy tick failed; check local storage and Consciousness activity.",
          }),
        );
      }, 5000);
      scheduler.unref();
      const suspend = () => {
        ptt.suspend(true);
        runtime.autonomy.suspend(true);
        plugins.game.suspend(true);
        plugins.minecraft.stopAction(false);
        void runtime.cancel();
      };
      const resume = () => {
        ptt.suspend(false);
        runtime.autonomy.suspend(false);
        plugins.game.suspend(false);
      };
      powerMonitor.on("suspend", suspend);
      powerMonitor.on("lock-screen", suspend);
      powerMonitor.on("resume", resume);
      powerMonitor.on("unlock-screen", resume);
      let pluginsClosed = false;
      let pluginsClosing = false;
      app.on("before-quit", (event) => {
        ptt.close();
        showVoiceActivity("idle");
        if (!pluginsClosed) {
          event.preventDefault();
          if (!pluginsClosing) {
            pluginsClosing = true;
            void Promise.allSettled([plugins.stop(), runtime.cancel()]).then(
              () => {
                pluginsClosed = true;
                app.quit();
              },
            );
          }
        }
        clearInterval(scheduler);
        runtime.autonomy.suspend(true);
      });
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
