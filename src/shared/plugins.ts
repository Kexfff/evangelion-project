import { z } from "zod";
import type { ImageAttachment } from "./images";
export const capabilities = [
  "channel:chat",
  "channel:images",
  "channel:voice",
  "channel:notify",
] as const;
export const capabilitySchema = z.enum(capabilities);
export type Capability = z.infer<typeof capabilitySchema>;
export const pluginManifestSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    name: z.string().min(1).max(80),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    apiVersion: z.literal(1),
    capabilities: z.array(capabilitySchema).max(4),
  })
  .strict();
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export const telegramManifest = pluginManifestSchema.parse({
  id: "telegram",
  name: "Telegram",
  version: "1.0.0",
  apiVersion: 1,
  capabilities: [...capabilities],
});
export const telegramSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    grants: z.array(capabilitySchema).max(4).default([]),
    voiceReplies: z.boolean().default(false),
    notifications: z.boolean().default(false),
  })
  .strict();
export type TelegramSettings = z.infer<typeof telegramSettingsSchema>;
export const defaultTelegramSettings = telegramSettingsSchema.parse({});
export const telegramStateSchema = z.object({
  installedVersion: z.string().default(""),
  config: telegramSettingsSchema.default(defaultTelegramSettings),
  offset: z.number().int().nonnegative().default(0),
  paired: z
    .object({
      userId: z.number().int().positive().safe(),
      chatId: z.number().int().positive().safe(),
      characterId: z.string().min(1).max(100),
    })
    .optional(),
  diagnostics: z
    .array(z.object({ at: z.string(), message: z.string().max(400) }))
    .max(100)
    .default([]),
});
export type TelegramState = z.infer<typeof telegramStateSchema>;
export interface PluginSnapshot extends TelegramState {
  status: string;
  hasToken: boolean;
  availableVersion: string;
}
export type PluginAction =
  "install" | "update" | "remove" | "disable" | "unpair" | "pair" | "restart";
export interface CompanionEvent {
  type: "message:received" | "message:sent" | "session:started";
  characterId: string;
  channel?: "desktop" | "telegram";
  text?: string;
}
/** Trusted adapters get these narrow operations, never a store or provider key. */
export interface ChannelContext {
  send(
    text: string,
    images: ImageAttachment[],
    signal: AbortSignal,
  ): Promise<string>;
  transcribe(bytes: ArrayBuffer, signal: AbortSignal): Promise<string>;
  speak(text: string, signal: AbortSignal): Promise<ArrayBuffer>;
  activeCharacter(): string;
  conversation(): string;
}
export interface ChannelPlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
  notify(text: string, signal: AbortSignal): Promise<void>;
}
export type { ScheduledTask } from "./autonomy";
