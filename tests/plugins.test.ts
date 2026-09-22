import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../electron/store";
import { CredentialVault } from "../electron/credentials";
import { CompanionRuntime } from "../electron/runtime";
import { PluginHost } from "../electron/plugin-host";
import { PluginEvents } from "../electron/plugin-events";
import { TelegramTransport } from "../electron/telegram-transport";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { TelegramChannel, telegramChunks } from "../electron/telegram";
import {
  TelegramHTTP,
  TelegramError,
  boundedBody,
  type TelegramAPI,
} from "../electron/telegram-api";
import {
  pluginManifestSchema,
  telegramManifest,
  telegramStateSchema,
  capabilities,
  type ChannelContext,
} from "../src/shared/plugins";
import { initialBehavior } from "../src/shared/autonomy";
import type { RuntimeEvent } from "../src/shared/schema";

const directories: string[] = [];
const channels: TelegramChannel[] = [];
const token = "123456:abcdefghijklmnopqrstuvwx0123456789";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf9sAAAAASUVORK5CYII=";
const signal = () => new AbortController().signal;
function store() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "eva-plugins-"));
  directories.push(dir);
  return new Store(dir);
}
function fixture() {
  const db = store();
  db.update((d) => {
    d.telegram = telegramStateSchema.parse({
      installedVersion: "1.0.0",
      config: { enabled: true, grants: [...capabilities] },
    });
  });
  let now = Date.now();
  const api = {
    call: vi.fn(
      async (
        method: string,
        _body: Record<string, unknown>,
        inputSignal: AbortSignal,
      ): Promise<unknown> => {
        if (method === "getFile")
          return { file_path: "photos/image.png", file_size: 68 };
        if (method === "getUpdates")
          return new Promise((_, reject) =>
            inputSignal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            ),
          );
        return {};
      },
    ),
    download: vi.fn(async () => Uint8Array.from(Buffer.from(png, "base64"))),
    close: vi.fn(async () => {}),
  } satisfies TelegramAPI;
  const context = {
    activeCharacter: () => db.characterId,
    conversation: () => `${db.characterId}/${db.sessionId}`,
    send: vi.fn(async () => "Hello from shared memory."),
    transcribe: vi.fn(async () => "Remember I like tea."),
    speak: vi.fn(async () => new ArrayBuffer(16)),
  } satisfies ChannelContext;
  const wait = vi.fn(async (ms: number, s: AbortSignal) => {
    s.throwIfAborted();
    now += ms;
  });
  const channel = new TelegramChannel(
    api,
    {
      get: () => db.data.telegram,
      update: (change) => db.update((d) => change(d.telegram)),
    },
    context,
    () => {},
    () => now,
    wait,
  );
  channels.push(channel);
  let sequence = 1;
  const update = (patch: Record<string, unknown> = {}) => ({
    update_id: sequence++,
    message: {
      message_id: sequence,
      date: Math.floor(now / 1000),
      from: { id: 42, is_bot: false },
      chat: { id: 42, type: "private" },
      text: "Hello",
      ...patch,
    },
  });
  const pair = async () => {
    await channel.consume(update({ text: channel.pair() }));
    api.call.mockClear();
  };
  return {
    db,
    api,
    channel,
    context,
    update,
    pair,
    wait,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
afterEach(async () => {
  await Promise.all(channels.splice(0).map((channel) => channel.stop()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true });
});

describe("plugin contracts, vault and lifecycle", () => {
  it("rejects incompatible API versions, arbitrary paths and unknown grants", () => {
    expect(pluginManifestSchema.parse(telegramManifest)).toEqual(
      telegramManifest,
    );
    expect(
      pluginManifestSchema.safeParse({ ...telegramManifest, apiVersion: 2 })
        .success,
    ).toBe(false);
    expect(
      pluginManifestSchema.safeParse({
        ...telegramManifest,
        entry: "/tmp/code.js",
      }).success,
    ).toBe(false);
    expect(
      pluginManifestSchema.safeParse({
        ...telegramManifest,
        capabilities: ["desktop:control"],
      }).success,
    ).toBe(false);
  });
  it("persists encrypted Telegram credentials beside existing provider keys", () => {
    const db = store(),
      dir = path.dirname(db.file);
    const vault = new CredentialVault(dir, null);
    vault.save({ telegram: token, llm: "llm-secret" });
    expect(readFileSync(vault.file, "utf8")).not.toContain(token);
    const next = new CredentialVault(dir, null);
    expect(next.get("telegram")).toBe(token);
    expect(next.get("llm")).toBe("llm-secret");
    next.save({ telegram: "" });
    expect(new CredentialVault(dir, null).has("telegram")).toBe(false);
  });
  it("installs disabled, requires permissions, removes configuration but retains memories", async () => {
    const db = store(),
      vault = new CredentialVault(path.dirname(db.file), null);
    const runtime = new CompanionRuntime(
      db,
      () => "",
      "local-file",
      () => {},
    );
    const host = new PluginHost(runtime, vault, () => {
      throw new Error("Should not connect");
    });
    await host.action("install");
    expect(host.snapshot().config.enabled).toBe(false);
    await expect(
      host.configure(
        {
          enabled: true,
          grants: [],
          notifications: false,
          voiceReplies: false,
        },
        token,
      ),
    ).rejects.toThrow("permission");
    await host.configure(
      {
        enabled: false,
        grants: ["channel:chat"],
        notifications: false,
        voiceReplies: false,
      },
      token,
    );
    expect(runtime.snapshot().plugins?.hasToken).toBe(true);
    expect(JSON.stringify(runtime.snapshot())).not.toContain(token);
    await host.action("remove");
    expect(db.data.telegram.installedVersion).toBe("");
    expect(vault.has("telegram")).toBe(false);
  });
  it("isolates event observers and supports unsubscribe", () => {
    const bus = new PluginEvents(),
      listener = vi.fn();
    bus.on(() => {
      throw new Error("plugin failed");
    });
    const off = bus.on(listener);
    bus.emit({
      type: "message:received",
      characterId: "eva",
      channel: "telegram",
    });
    off();
    bus.emit({ type: "message:sent", characterId: "eva" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("Telegram authorization and routing", () => {
  it("ignores unpaired, group and bot messages without downloading or invoking the LLM", async () => {
    const f = fixture();
    await f.channel.consume(
      f.update({ document: { file_id: "secret", mime_type: "image/png" } }),
    );
    await f.channel.consume(
      f.update({ text: f.channel.pair(), chat: { id: -42, type: "group" } }),
    );
    await f.channel.consume(
      f.update({ text: f.channel.pair(), from: { id: 42, is_bot: true } }),
    );
    expect(f.api.call).not.toHaveBeenCalled();
    expect(f.context.send).not.toHaveBeenCalled();
    expect(f.db.data.telegram.paired).toBeUndefined();
  });
  it("pairs once with an expiring secret, persists exact IDs and rejects another account", async () => {
    const f = fixture();
    const expired = f.channel.pair();
    f.advance(300001);
    await f.channel.consume(f.update({ text: expired }));
    expect(f.db.data.telegram.paired).toBeUndefined();
    await f.pair();
    expect(new Store(path.dirname(f.db.file)).data.telegram.paired).toEqual({
      userId: 42,
      chatId: 42,
      characterId: "eva",
    });
    expect(() => f.channel.pair()).toThrow("Unpair");
    await f.channel.consume(
      f.update({
        from: { id: 43, is_bot: false },
        chat: { id: 43, type: "private" },
      }),
    );
    expect(f.context.send).not.toHaveBeenCalled();
  });
  it("claims updates before work and ignores duplicates even after reopening storage", async () => {
    const f = fixture();
    await f.pair();
    const update = f.update();
    f.context.send.mockImplementation(async () => {
      expect(new Store(path.dirname(f.db.file)).data.telegram.offset).toBe(
        update.update_id + 1,
      );
      return "Hi";
    });
    await f.channel.consume(update);
    await f.channel.consume(update);
    expect(f.context.send).toHaveBeenCalledTimes(1);
  });
  it("routes image documents and captions through validated multimodal attachments", async () => {
    const f = fixture();
    await f.pair();
    await f.channel.consume(
      f.update({
        text: undefined,
        caption: "What is this?",
        document: { file_id: "image", mime_type: "image/png", file_size: 68 },
      }),
    );
    expect(f.context.send).toHaveBeenCalledWith(
      "What is this?",
      [{ name: expect.any(String), dataUrl: `data:image/png;base64,${png}` }],
      expect.any(AbortSignal),
    );
    expect(f.api.download).toHaveBeenCalledTimes(1);
  });
  it("accepts image-only photos and chooses a size within 2 MB", async () => {
    const f = fixture();
    await f.pair();
    f.api.download.mockResolvedValue(
      Uint8Array.from([255, 216, 255, 224, 0, 0]),
    );
    await f.channel.consume(
      f.update({
        text: undefined,
        photo: [
          { file_id: "small", file_size: 6 },
          { file_id: "too-big", file_size: 3000000 },
        ],
      }),
    );
    expect(f.api.call).toHaveBeenCalledWith(
      "getFile",
      { file_id: "small" },
      expect.any(AbortSignal),
    );
    expect(f.context.send).toHaveBeenCalledWith(
      "",
      [
        expect.objectContaining({
          dataUrl: expect.stringContaining("data:image/jpeg"),
        }),
      ],
      expect.any(AbortSignal),
    );
  });
  it("rejects image permission denial, unsupported documents, oversized and malformed images", async () => {
    const f = fixture();
    await f.pair();
    const image = {
      text: undefined,
      document: { file_id: "image", mime_type: "image/png", file_size: 68 },
    };
    f.db.update((d) => {
      d.telegram.config.grants = ["channel:chat"];
    });
    await f.channel.consume(f.update(image));
    expect(f.api.download).not.toHaveBeenCalled();
    f.db.update((d) => {
      d.telegram.config.grants = [...capabilities];
    });
    await f.channel.consume(
      f.update({
        ...image,
        document: { ...image.document, mime_type: "text/html" },
      }),
    );
    await f.channel.consume(
      f.update({
        ...image,
        document: { ...image.document, file_size: 3000000 },
      }),
    );
    expect(f.api.download).not.toHaveBeenCalled();
    f.api.download.mockResolvedValue(new Uint8Array([1, 2, 3]));
    await f.channel.consume(f.update(image));
    expect(f.context.send).not.toHaveBeenCalled();
    f.api.download.mockImplementation(async () => {
      f.db.update((d) => {
        d.sessions.eva = "new-session";
      });
      return Uint8Array.from(Buffer.from(png, "base64"));
    });
    await f.channel.consume(f.update(image));
    expect(f.context.send).not.toHaveBeenCalled();
  });
  it("routes permitted OGG voice through ASR and optionally replies with MP3", async () => {
    const f = fixture();
    await f.pair();
    f.db.update((d) => {
      d.telegram.config.voiceReplies = true;
    });
    await f.channel.consume(
      f.update({
        text: undefined,
        voice: { file_id: "voice", file_size: 64, duration: 4 },
      }),
    );
    expect(f.context.transcribe).toHaveBeenCalledTimes(1);
    expect(f.context.send).toHaveBeenCalledWith(
      "Remember I like tea.",
      [],
      expect.any(AbortSignal),
    );
    expect(f.api.call).toHaveBeenCalledWith(
      "sendVoice",
      expect.objectContaining({ chat_id: 42, audio: expect.any(Uint8Array) }),
      expect.any(AbortSignal),
    );
    await f.channel.consume(
      f.update({ text: undefined, voice: { file_id: "voice", duration: 61 } }),
    );
    expect(f.context.transcribe).toHaveBeenCalledTimes(1);
  });
  it("caps inbound traffic and prevents inactive-character leakage", async () => {
    const f = fixture();
    await f.pair();
    // Bypass output time so all inputs remain in the same minute.
    f.wait.mockImplementation(async () => {});
    for (let i = 0; i < 14; i++) await f.channel.consume(f.update());
    expect(f.context.send).toHaveBeenCalledTimes(12);
    f.advance(61000);
    f.db.update((d) => {
      d.telegram.paired!.characterId = "other";
    });
    await f.channel.consume(f.update());
    expect(f.context.send).toHaveBeenCalledTimes(12);
  });
  it("stopping aborts in-flight channel work and prevents reply delivery", async () => {
    const f = fixture();
    await f.pair();
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    f.context.send.mockImplementation(
      async (...args: unknown[]) =>
        new Promise((_, reject) => {
          const s = args[2] as AbortSignal;
          began();
          s.addEventListener("abort", () => reject(new Error("stopped")), {
            once: true,
          });
        }),
    );
    const work = f.channel.consume(f.update());
    await started;
    await f.channel.stop();
    await work;
    expect(f.api.call).not.toHaveBeenCalledWith(
      "sendMessage",
      expect.anything(),
      expect.anything(),
    );
    await expect(f.channel.consume(f.update())).rejects.toThrow();
  });
  it("chunks Unicode safely and retries only explicit rate rejections", async () => {
    expect(telegramChunks("a".repeat(3999) + "😀ok").join("")).toBe(
      "a".repeat(3999) + "😀ok",
    );
    expect(telegramChunks("a".repeat(3999) + "😀ok")[0]).toHaveLength(3999);
    const f = fixture();
    await f.pair();
    f.context.send.mockResolvedValue("a".repeat(8100));
    f.api.call
      .mockRejectedValueOnce(new TelegramError(429, 2))
      .mockResolvedValue({});
    await f.channel.consume(f.update());
    expect(
      f.api.call.mock.calls.filter(([method]) => method === "sendMessage"),
    ).toHaveLength(4);
    expect(f.wait.mock.calls.some(([ms]) => ms >= 2000)).toBe(true);
  });
  it("requires notification permission and a healthy connection", async () => {
    const f = fixture();
    await f.pair();
    expect(f.channel.available()).toBe(false);
    f.db.update((d) => {
      d.telegram.config.notifications = true;
    });
    await f.channel.start();
    await vi.waitFor(() => expect(f.channel.status).toBe("Connected"));
    expect(f.channel.available()).toBe(true);
    await f.channel.notify("Reminder", signal());
    expect(f.api.call).toHaveBeenCalledWith(
      "sendMessage",
      expect.objectContaining({ text: "Reminder" }),
      expect.any(AbortSignal),
    );
    f.db.update((d) => {
      d.telegram.config.grants = ["channel:chat"];
    });
    await expect(f.channel.notify("No", signal())).rejects.toThrow();
  });
  it("stops reconnecting after eight failures and never logs provider bodies or tokens", async () => {
    const f = fixture();
    f.api.call.mockRejectedValue(new Error(`secret ${token}`));
    await f.channel.start();
    await vi.waitFor(() =>
      expect(f.channel.status).toBe("Failed — restart plugin"),
    );
    expect(f.api.call).toHaveBeenCalledTimes(8);
    expect(JSON.stringify(f.db.data)).not.toContain(token);
    expect(f.wait.mock.calls.every(([ms]) => ms <= 60000)).toBe(true);
  });
});

describe("shared runtime and transport", () => {
  it("runs the actual network worker with fixture HTTP, bounded RPC and cancellation", async () => {
    const db = store(),
      file = path.join(path.dirname(db.file), "worker.mjs");
    await build({
      entryPoints: ["tests/fixtures/telegram-worker.ts"],
      outfile: file,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
    });
    const transport = new TelegramTransport(token, pathToFileURL(file));
    try {
      expect(await transport.call("getMe", {}, signal())).toMatchObject({
        is_bot: true,
      });
      expect(
        await transport.download("photos/test.jpg", 100, signal()),
      ).toEqual(new Uint8Array([255, 216, 255, 224]));
      await expect(
        transport.download("../secret", 100, signal()),
      ).rejects.toMatchObject({ code: 400 });
      await expect(
        transport.call("arbitraryMethod", {}, signal()),
      ).rejects.toMatchObject({ code: 403 });
      const controller = new AbortController();
      const poll = transport.call("getUpdates", {}, controller.signal);
      const rejected = expect(poll).rejects.toMatchObject({ code: 499 });
      controller.abort();
      await rejected;
    } finally {
      await transport.close();
    }
    await expect(transport.call("getMe", {}, signal())).rejects.toMatchObject({
      code: 503,
    });
  });
  it("connects host → polling → pairing → shared runtime → Telegram and disables cleanly", async () => {
    const db = store(),
      runtime = new CompanionRuntime(
        db,
        () => "",
        "local-file",
        () => {},
      );
    const vault = new CredentialVault(path.dirname(db.file), null);
    const updates: unknown[] = [];
    const api = {
      call: vi.fn(async (method: string): Promise<unknown> =>
        method === "getUpdates" ? updates.splice(0) : {},
      ),
      download: vi.fn(async () => new Uint8Array()),
      close: vi.fn(async () => {}),
    };
    const host = new PluginHost(runtime, vault, () => api);
    vi.spyOn(runtime.provider, "chat").mockResolvedValue(
      "Your desktop memory is here.",
    );
    try {
      await host.action("install");
      await host.configure(
        {
          enabled: true,
          grants: ["channel:chat"],
          voiceReplies: false,
          notifications: false,
        },
        token,
      );
      const command = await host.action("pair");
      const message = (text: string, id: number) => ({
        update_id: id,
        message: {
          message_id: id,
          date: Math.floor(Date.now() / 1000),
          from: { id: 42, is_bot: false },
          chat: { id: 42, type: "private" },
          text,
        },
      });
      updates.push(message(command!, 1));
      await vi.waitFor(() => expect(host.snapshot().paired?.userId).toBe(42));
      updates.push(message("Remember desktop?", 2));
      await vi.waitFor(
        () =>
          expect(db.data.messages.at(-1)?.content).toBe(
            "Your desktop memory is here.",
          ),
        { timeout: 2500 },
      );
      await vi.waitFor(
        () =>
          expect(api.call).toHaveBeenCalledWith(
            "sendMessage",
            expect.objectContaining({ text: "Your desktop memory is here." }),
            expect.any(AbortSignal),
          ),
        { timeout: 2500 },
      );
      await host.action("disable");
      const calls = api.call.mock.calls.length;
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(api.call).toHaveBeenCalledTimes(calls);
      expect(api.close).toHaveBeenCalledTimes(1);
      expect(
        new Store(path.dirname(db.file)).data.telegram.config.enabled,
      ).toBe(false);
    } finally {
      await host.stop();
    }
  });
  it("Telegram replies recall desktop facts and messages, persist images, and avoid desktop audio deltas", async () => {
    const db = store(),
      events: RuntimeEvent[] = [];
    const runtime = new CompanionRuntime(
      db,
      () => "",
      "local-file",
      (e) => events.push(e),
    );
    db.update((d) => {
      d.facts.push({
        id: "tea",
        characterId: "eva",
        text: "My favorite tea is jasmine.",
        source: "manual",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
    const chat = vi
      .spyOn(runtime.provider, "chat")
      .mockResolvedValue("Jasmine tea!");
    await runtime.send("Let's discuss tea.");
    events.length = 0;
    const image = { name: "tea.png", dataUrl: `data:image/png;base64,${png}` };
    expect(
      await runtime.send("What tea do I like?", [image], "telegram", signal()),
    ).toBe("Jasmine tea!");
    const payload = JSON.stringify(chat.mock.calls.at(-1)?.[2]);
    expect(payload).toContain("jasmine");
    expect(payload).toContain("Let's discuss tea.");
    expect(payload).toContain("image_url");
    expect(events.some((e) => e.type === "delta" || e.type === "phase")).toBe(
      false,
    );
    const persisted = new Store(path.dirname(db.file));
    expect(persisted.data.messages.at(-2)?.images).toEqual([image]);
    expect(persisted.data.messages.at(-1)?.sessionId).toBe(db.sessionId);
    expect(persisted.data.messages.at(-1)?.channel).toBe("telegram");
  });
  it("enforces one owner and cancels remote generation without saving a partial assistant", async () => {
    const db = store(),
      runtime = new CompanionRuntime(
        db,
        () => "",
        "local-file",
        () => {},
      );
    vi.spyOn(runtime.provider, "chat").mockImplementation(
      async (_p, _k, _m, _d, s) =>
        new Promise((_, reject) => {
          s!.addEventListener("abort", () => reject(new Error("Cancelled")), {
            once: true,
          });
        }),
    );
    const c = new AbortController();
    const turn = runtime.send("Remote", [], "telegram", c.signal);
    await expect(runtime.send("Desktop")).rejects.toThrow(
      "already in progress",
    );
    const rejected = expect(turn).rejects.toThrow("Cancelled");
    c.abort();
    await rejected;
    expect(db.data.messages.map((m) => m.role)).toEqual(["user"]);
    expect(runtime.busy).toBe(false);
  });
  it("delivers authorized reminders to a remote channel without a visible avatar, preserving pause", async () => {
    const db = store();
    let now = Date.now();
    const events: RuntimeEvent[] = [];
    const runtime = new CompanionRuntime(
      db,
      () => "",
      "local-file",
      (e) => events.push(e),
      () => now,
    );
    db.update((d) => {
      d.settings.autonomy.enabled = true;
      d.settings.autonomy.quietEnabled = false;
      d.automation.states.eva = {
        ...initialBehavior(now),
        lastInteraction: now - 60000,
      };
    });
    const notify = vi.fn(async () => {});
    runtime.remote = { available: () => true, notify };
    vi.spyOn(runtime.provider, "chat").mockResolvedValue("Tea time.");
    const task = runtime.autonomy.createTask({
      title: "Tea",
      intent: "Have tea",
      dueAt: new Date(now + 1000).toISOString(),
      timeZone: "UTC",
    });
    now += 2000;
    await runtime.pauseAutonomy(true);
    await runtime.autonomy.tick();
    expect(notify).not.toHaveBeenCalled();
    await runtime.pauseAutonomy(false);
    runtime.autonomy.setPresence({ visible: false, blocked: true });
    await runtime.autonomy.tick();
    expect(notify).not.toHaveBeenCalled();
    runtime.autonomy.setPresence({ visible: false, blocked: false });
    await runtime.autonomy.tick();
    await runtime.autonomy.tick();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(db.data.automation.tasks.find((t) => t.id === task.id)?.status).toBe(
      "done",
    );
    expect(events.some((e) => e.type === "autonomous-start")).toBe(false);
    expect(db.data.messages.at(-1)?.channel).toBe("telegram");
  });
  it("uses the fixed API origin, JSON text, multipart MP3 and rejects unsafe file paths", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: {} })),
      );
    const api = new TelegramHTTP(token, request);
    await api.call("sendMessage", { chat_id: 42, text: "Hi" }, signal());
    expect(request.mock.calls[0][0]).toBe(
      `https://api.telegram.org/bot${token}/sendMessage`,
    );
    expect(request.mock.calls[0][1]?.redirect).toBe("error");
    request.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: {} })),
    );
    await api.call(
      "sendVoice",
      { chat_id: 42, audio: new Uint8Array([1, 2]) },
      signal(),
    );
    expect(request.mock.calls[1][1]?.body).toBeInstanceOf(FormData);
    await expect(
      api.download("../../private", 1024, signal()),
    ).rejects.toThrow();
    await expect(api.call("deleteWebhook", {}, signal())).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("redacts URL-bearing fetch failures, bounds streaming downloads, and parses retry_after", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`https://api.telegram.org/bot${token}`));
    const api = new TelegramHTTP(token, request);
    await expect(api.call("getMe", {}, signal())).rejects.toThrow(
      "Telegram request failed.",
    );
    request.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          description: token,
          parameters: { retry_after: 8 },
        }),
        { status: 429 },
      ),
    );
    await expect(api.call("getMe", {}, signal())).rejects.toMatchObject({
      code: 429,
      retryAfter: 8,
    });
    await expect(
      boundedBody(new Response(new Uint8Array(20)), 10),
    ).rejects.toMatchObject({ code: 413 });
  });
});
