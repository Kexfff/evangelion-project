import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { TelegramChannel } from "./telegram";
import { TelegramTransport } from "./telegram-transport";
import type { TelegramAPI } from "./telegram-api";
import type { CompanionRuntime } from "./runtime";
import type { CredentialVault } from "./credentials";
import {
  telegramManifest,
  pluginManifestSchema,
  telegramSettingsSchema,
  telegramStateSchema,
  type PluginAction,
  type PluginSnapshot,
  type TelegramSettings,
  type Capability,
} from "../src/shared/plugins";

/** Built-in catalog only. No manifest-provided paths, imports, commands or network origins. */
export class TelegramPlugin {
  readonly id = "telegram";
  readonly kind = "channel" as const;
  private channel?: TelegramChannel;
  private changing = false;
  private status = "Not installed";
  constructor(
    private runtime: CompanionRuntime,
    private vault: CredentialVault,
    private transport: (token: string) => TelegramAPI = (token) =>
      new TelegramTransport(token),
  ) {
    pluginManifestSchema.parse(telegramManifest);
    runtime.pluginSnapshot = () => this.snapshot();
    runtime.remote = {
      available: () => this.channel?.available() ?? false,
      notify: async (text, signal) => {
        if (!this.channel) throw new Error("Channel is disabled.");
        await this.channel.notify(text, signal);
      },
    };
  }
  private get store() {
    return this.runtime.store;
  }
  snapshot(): PluginSnapshot {
    return {
      ...this.store.data.telegram,
      status: this.channel?.status ?? this.status,
      hasToken: this.vault.has("telegram"),
      availableVersion: telegramManifest.version,
    };
  }
  private changed = () => this.runtime.broadcast();
  private assertGrant(capability: Capability) {
    const state = this.store.data.telegram;
    if (
      !state.config.enabled ||
      !state.config.grants.includes(capability) ||
      state.paired?.characterId !== this.store.characterId
    )
      throw new Error("Plugin permission or paired character unavailable.");
  }
  async start() {
    if (this.channel) return;
    const s = this.store.data.telegram;
    this.status = s.installedVersion ? "Disabled" : "Not installed";
    if (!s.installedVersion || !s.config.enabled) return;
    if (s.installedVersion !== telegramManifest.version) {
      this.status = "Update bundled plugin before enabling";
      return;
    }
    try {
      if (!s.config.grants.includes("channel:chat"))
        throw new Error("Missing grant");
      const token = z
        .string()
        .regex(/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/)
        .parse(this.vault.get("telegram"));
      const channel = new TelegramChannel(
        this.transport(token),
        {
          get: () => this.store.data.telegram,
          update: (change) => this.store.update((d) => change(d.telegram)),
        },
        {
          activeCharacter: () => this.store.characterId,
          conversation: () =>
            `${this.store.characterId}/${this.store.sessionId}`,
          send: async (text, images, signal) => {
            this.assertGrant("channel:chat");
            if (images.length) this.assertGrant("channel:images");
            const characterId = this.store.characterId,
              sessionId = this.store.sessionId;
            const deadline = Date.now() + 60000;
            while (this.runtime.busy) {
              if (Date.now() >= deadline)
                throw new Error("Conversation busy. Please retry.");
              await delay(200, undefined, { signal });
            }
            signal.throwIfAborted();
            this.assertGrant("channel:chat");
            if (
              characterId !== this.store.characterId ||
              sessionId !== this.store.sessionId
            )
              throw new Error("Conversation changed while waiting.");
            return this.runtime.send(text, images, "telegram", signal);
          },
          transcribe: (bytes, signal) => {
            this.assertGrant("channel:voice");
            return this.runtime.transcribe(
              bytes,
              "audio/ogg;codecs=opus",
              signal,
            );
          },
          speak: (text, signal) => {
            this.assertGrant("channel:voice");
            return this.runtime.speak(text, signal);
          },
        },
        this.changed,
      );
      this.channel = channel;
      await channel.start();
    } catch {
      this.status =
        "Cannot start: check saved token, vault and chat permission";
      await this.stop();
    }
    this.changed();
  }
  async stop() {
    const channel = this.channel;
    this.channel = undefined;
    if (channel)
      await Promise.all([
        channel.stop(),
        this.runtime.cancelChannel("telegram"),
      ]);
  }
  private async exclusive<T>(operation: () => Promise<T>) {
    if (this.changing) throw new Error("Plugin operation in progress.");
    this.changing = true;
    try {
      return await operation();
    } finally {
      this.changing = false;
      this.changed();
    }
  }
  async withPaused<T>(operation: () => Promise<T>) {
    return this.exclusive(async () => {
      await this.stop();
      try {
        return await operation();
      } finally {
        await this.start();
      }
    });
  }
  async configure(raw: TelegramSettings, rawToken?: string) {
    const config = telegramSettingsSchema.parse(raw);
    const token =
      rawToken === undefined
        ? undefined
        : z
            .string()
            .regex(/^(?:\d{5,20}:[A-Za-z0-9_-]{20,100})?$/)
            .parse(rawToken);
    if (!this.store.data.telegram.installedVersion)
      throw new Error("Install the bundled plugin first.");
    if (
      config.enabled &&
      (!config.grants.includes("channel:chat") ||
        !(token ?? this.vault.get("telegram")))
    )
      throw new Error(
        "A token and chat permission are required to enable Telegram.",
      );
    if (
      (config.voiceReplies && !config.grants.includes("channel:voice")) ||
      (config.notifications && !config.grants.includes("channel:notify"))
    )
      throw new Error("Grant the corresponding capability first.");
    await this.exclusive(async () => {
      await this.stop();
      if (token !== undefined) this.vault.save({ telegram: token });
      this.store.update((d) => {
        d.telegram.config = config;
        // A new bot identity must never inherit the old allowlist or update cursor.
        if (token !== undefined) {
          d.telegram.paired = undefined;
          d.telegram.offset = 0;
        }
      });
      await this.start();
    });
  }
  async action(action: PluginAction): Promise<string | void> {
    return this.exclusive(async () => {
      if (action === "pair") {
        if (!this.channel) throw new Error("Enable and start Telegram first.");
        return this.channel.pair();
      }
      await this.stop();
      if (action === "remove") {
        this.vault.save({ telegram: "" });
        this.store.update((d) => {
          d.telegram = telegramStateSchema.parse({});
        });
      } else
        this.store.update((d) => {
          if (action === "install" || action === "update") {
            d.telegram.installedVersion = telegramManifest.version;
            d.telegram.config.enabled = false;
          }
          if (action === "disable") d.telegram.config.enabled = false;
          if (action === "unpair") {
            d.telegram.paired = undefined;
            d.telegram.config.enabled = false;
          }
        });
      await this.start();
    });
  }
}
