import { randomBytes, timingSafeEqual } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { imageAttachmentSchema, MAX_IMAGE_BYTES } from "../src/shared/images";
import type { ImageAttachment } from "../src/shared/images";
import type {
  ChannelContext,
  ChannelPlugin,
  TelegramState,
  Capability,
} from "../src/shared/plugins";
import { TelegramError, type TelegramAPI } from "./telegram-api";

const fileSchema = z.object({
  file_id: z.string().min(1).max(512),
  file_size: z.number().int().nonnegative().optional(),
});
const messageSchema = z.object({
  message_id: z.number().int(),
  date: z.number().int(),
  from: z.object({
    id: z.number().int().positive().safe(),
    is_bot: z.boolean(),
  }),
  chat: z.object({ id: z.number().int().safe(), type: z.string() }),
  text: z.string().max(8000).optional(),
  caption: z.string().max(8000).optional(),
  photo: z.array(fileSchema).max(20).optional(),
  document: fileSchema
    .extend({ mime_type: z.string().max(100).optional() })
    .optional(),
  voice: fileSchema.extend({ duration: z.number().nonnegative() }).optional(),
});
const updateSchema = z.object({
  update_id: z.number().int().nonnegative().safe(),
  message: z.unknown().optional(),
});
export function telegramChunks(text: string, limit = 4000) {
  const result: string[] = [];
  while (text.length) {
    let end = Math.min(limit, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    result.push(text.slice(0, end));
    text = text.slice(end);
  }
  return result;
}
type StateAccess = {
  get(): TelegramState;
  update(change: (state: TelegramState) => void): void;
};
type Wait = (ms: number, signal: AbortSignal) => Promise<void>;
export class TelegramChannel implements ChannelPlugin {
  private controller = new AbortController();
  private loop?: Promise<void>;
  private code?: { value: string; expires: number; characterId: string };
  private lastSend = 0;
  private outgoing: Promise<unknown> = Promise.resolve();
  private incomingTimes: number[] = [];
  private connected = false;
  private processing = false;
  status = "Stopped";
  constructor(
    private api: TelegramAPI,
    private state: StateAccess,
    private context: ChannelContext,
    private changed: () => void,
    private now: () => number = Date.now,
    private wait: Wait = async (ms, signal) => {
      await delay(ms, undefined, { signal });
    },
  ) {}
  private granted(capability: Capability) {
    return this.state.get().config.grants.includes(capability);
  }
  private assertGrant(capability: Capability) {
    this.controller.signal.throwIfAborted();
    if (!this.state.get().config.enabled || !this.granted(capability))
      throw new Error("Plugin capability not granted.");
  }
  log(message: string) {
    this.state.update((s) => {
      s.diagnostics.push({ at: new Date(this.now()).toISOString(), message });
      s.diagnostics = s.diagnostics.slice(-100);
    });
    this.changed();
  }
  pair() {
    this.assertGrant("channel:chat");
    if (this.state.get().paired)
      throw new Error("Unpair the current account first.");
    this.code = {
      value: randomBytes(16).toString("hex"),
      expires: this.now() + 300000,
      characterId: this.context.activeCharacter(),
    };
    return `/start ${this.code.value}`;
  }
  available() {
    const s = this.state.get();
    return (
      this.connected &&
      !this.processing &&
      !this.controller.signal.aborted &&
      s.config.enabled &&
      s.config.notifications &&
      this.granted("channel:notify") &&
      this.granted("channel:chat") &&
      !!s.paired &&
      s.paired.characterId === this.context.activeCharacter()
    );
  }
  async start() {
    if (this.loop) return;
    this.assertGrant("channel:chat");
    this.status = "Connecting";
    this.changed();
    this.loop = this.poll().catch(() => {
      if (!this.controller.signal.aborted) {
        this.status = "Failed — restart plugin";
        this.connected = false;
        this.log("Plugin stopped unexpectedly; restart from Settings.");
      }
    });
  }
  async stop() {
    this.controller.abort();
    this.connected = false;
    this.code = undefined;
    await this.api.close();
    await this.loop;
    await this.outgoing.catch(() => {});
    this.status = "Stopped";
  }
  private async poll() {
    let failures = 0;
    const signal = this.controller.signal;
    while (!signal.aborted) {
      try {
        if (!this.connected) {
          await this.api.call("getMe", {}, signal);
          signal.throwIfAborted();
          this.connected = true;
          this.status = "Connected";
          this.log(
            "Connected to Telegram. Only the paired private chat is accepted.",
          );
        }
        const result = z
          .array(z.unknown())
          .max(20)
          .parse(
            await this.api.call(
              "getUpdates",
              {
                offset: this.state.get().offset,
                limit: 20,
                timeout: 25,
                allowed_updates: ["message"],
              },
              signal,
            ),
          );
        signal.throwIfAborted();
        failures = 0;
        for (const update of result) {
          signal.throwIfAborted();
          await this.consume(update);
        }
        // Also protects against broken endpoints returning empty polls immediately.
        await this.wait(250, signal);
      } catch (error) {
        if (signal.aborted) return;
        this.connected = false;
        failures++;
        const code = error instanceof TelegramError ? error.code : 502;
        this.status = `Connection error (${code})`;
        this.log(
          code === 401
            ? "Token rejected. Save a valid token and restart."
            : code === 409
              ? "Polling conflict. Stop other instances/webhooks before restarting."
              : "Connection failed; bounded reconnect backoff is active.",
        );
        if (
          code === 401 ||
          code === 409 ||
          failures >= 8 ||
          (error instanceof TelegramError && error.retryAfter > 60)
        ) {
          this.status = "Failed — restart plugin";
          this.changed();
          return;
        }
        await this.wait(
          Math.max(
            error instanceof TelegramError ? error.retryAfter * 1000 : 0,
            Math.min(60000, 1000 * 2 ** (failures - 1)),
          ),
          signal,
        );
      }
    }
  }
  /** Durable claim BEFORE downloads/model work: an ambiguous crash is never auto-replayed. */
  async consume(raw: unknown) {
    this.assertGrant("channel:chat");
    const parsed = updateSchema.safeParse(raw);
    if (!parsed.success) return;
    const update = parsed.data;
    if (update.update_id < this.state.get().offset) return;
    this.state.update((s) => {
      s.offset = update.update_id + 1;
    });
    const parsedMessage = messageSchema.safeParse(update.message);
    if (!parsedMessage.success) return;
    const message = parsedMessage.data;
    if (
      message.chat.type !== "private" ||
      message.from.is_bot ||
      message.chat.id !== message.from.id
    )
      return;
    const paired = this.state.get().paired;
    if (!paired) {
      const supplied = /^\/start ([a-f0-9]{32})$/.exec(message.text ?? "")?.[1];
      if (
        !supplied ||
        !this.code ||
        this.now() >= this.code.expires ||
        this.code.characterId !== this.context.activeCharacter() ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(this.code.value))
      )
        return;
      const characterId = this.code.characterId;
      this.code = undefined;
      this.state.update((s) => {
        s.paired = {
          userId: message.from.id,
          chatId: message.chat.id,
          characterId,
        };
      });
      this.log("Private account paired to the selected character.");
      await this.sendText(
        message.chat.id,
        "Paired. Text, photos and voice notes use your companion’s shared history and memory, subject to your desktop permissions.",
        this.controller.signal,
      );
      return;
    }
    if (message.from.id !== paired.userId || message.chat.id !== paired.chatId)
      return;
    if (paired.characterId !== this.context.activeCharacter()) {
      this.log("Message skipped: paired character is not active on desktop.");
      return;
    }
    if (this.now() - message.date * 1000 > 86400000) {
      this.log("Message older than 24 hours skipped.");
      return;
    }
    this.incomingTimes = this.incomingTimes.filter(
      (time) => this.now() - time < 60000,
    );
    if (this.incomingTimes.length >= 12) {
      this.log("Inbound limit (12 messages/minute) reached; message skipped.");
      return;
    }
    this.incomingTimes.push(this.now());
    const signal = this.controller.signal;
    const conversation = this.context.conversation();
    this.processing = true;
    this.log(
      "Message accepted; interrupted processing is not automatically replayed.",
    );
    try {
      if (message.text === "/start" || message.text === "/help") {
        await this.sendText(
          paired.chatId,
          "Send text, one photo/image document, or a voice note (up to 60 seconds). All chats use the active paired character’s desktop memory. Approve reminders and manage permissions in desktop Settings.",
          signal,
        );
        return;
      }
      let text = message.text ?? message.caption ?? "";
      const images: ImageAttachment[] = [];
      if (message.photo?.length || message.document) {
        this.assertGrant("channel:images");
        if (
          message.document &&
          !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
            message.document.mime_type ?? "",
          )
        )
          throw new Error("Unsupported image document.");
        const file =
          message.document ??
          [...message.photo!]
            .reverse()
            .find((f) => !f.file_size || f.file_size <= MAX_IMAGE_BYTES);
        if (!file) throw new Error("Image too large.");
        const bytes = await this.file(file, MAX_IMAGE_BYTES, signal);
        const mime = message.document?.mime_type ?? "image/jpeg";
        images.push(
          imageAttachmentSchema.parse({
            name: `telegram-${message.message_id}`,
            dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
          }),
        );
      }
      if (message.voice) {
        this.assertGrant("channel:voice");
        if (message.voice.duration > 60)
          throw new Error("Voice note too long.");
        const bytes = await this.file(message.voice, 10 * 1024 * 1024, signal);
        text = await this.context.transcribe(
          Uint8Array.from(bytes).buffer,
          signal,
        );
      }
      signal.throwIfAborted();
      if (conversation !== this.context.conversation())
        throw new Error("Conversation changed while processing.");
      if (!text.trim() && !images.length)
        throw new Error("Unsupported message.");
      const reply = await this.context.send(text, images, signal);
      await this.sendText(paired.chatId, reply, signal);
      this.log(
        "Reply delivered; conversation and memory are shared with desktop.",
      );
      if (
        this.state.get().config.voiceReplies &&
        this.granted("channel:voice")
      ) {
        try {
          const bytes = await this.context.speak(reply.slice(0, 12000), signal);
          await this.output(
            "sendVoice",
            { chat_id: paired.chatId, audio: new Uint8Array(bytes) },
            signal,
          );
        } catch {
          if (!signal.aborted)
            this.log(
              "Text delivered, but voice synthesis/delivery failed. Check TTS settings.",
            );
        }
      }
    } catch {
      if (!signal.aborted) {
        this.log(
          "Message failed or delivery is uncertain; not replayed. Check provider permissions, file limits and desktop activity.",
        );
        // Do not retry a possibly delivered response. A separate error notice is safe.
        await this.sendText(
          paired.chatId,
          "I couldn’t complete this message. Check desktop diagnostics, provider settings and permissions, then resend when ready. Images: 2 MB; voice: 60 seconds/10 MB.",
          signal,
        ).catch(() => {});
      }
    } finally {
      this.processing = false;
      this.changed();
    }
  }
  private async file(
    file: z.infer<typeof fileSchema>,
    limit: number,
    signal: AbortSignal,
  ) {
    if (file.file_size && file.file_size > limit)
      throw new Error("Attachment exceeds limit.");
    const metadata = z
      .object({
        file_path: z.string().max(300),
        file_size: z.number().optional(),
      })
      .parse(await this.api.call("getFile", { file_id: file.file_id }, signal));
    if (metadata.file_size && metadata.file_size > limit)
      throw new Error("Attachment exceeds limit.");
    return this.api.download(metadata.file_path, limit, signal);
  }
  private output(
    method: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    const combined = AbortSignal.any([signal, this.controller.signal]);
    const work = this.outgoing
      .catch(() => {})
      .then(async () => {
        this.assertGrant("channel:chat");
        combined.throwIfAborted();
        await this.wait(
          Math.max(0, 1100 - (this.now() - this.lastSend)),
          combined,
        );
        for (let attempt = 0; attempt < 3; attempt++) {
          combined.throwIfAborted();
          this.lastSend = this.now();
          try {
            await this.api.call(method, body, combined);
            return;
          } catch (error) {
            // Only explicit 429 rejection is retryable; timeouts/5xx may already have sent.
            if (
              !(error instanceof TelegramError) ||
              error.code !== 429 ||
              error.retryAfter > 60 ||
              attempt === 2
            )
              throw error;
            await this.wait(Math.max(1100, error.retryAfter * 1000), combined);
          }
        }
      });
    this.outgoing = work;
    return work;
  }
  private async sendText(chatId: number, text: string, signal: AbortSignal) {
    for (const chunk of telegramChunks(text))
      await this.output(
        "sendMessage",
        {
          chat_id: chatId,
          text: chunk,
          link_preview_options: { is_disabled: true },
        },
        signal,
      );
  }
  async notify(text: string, signal: AbortSignal) {
    if (!this.available())
      throw new Error("Telegram notifications unavailable.");
    this.assertGrant("channel:notify");
    await this.sendText(this.state.get().paired!.chatId, text, signal);
    this.log("Scheduled/proactive message delivered to Telegram.");
  }
}
