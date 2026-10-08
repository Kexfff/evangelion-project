import { z } from "zod";
import { pttConfigSchema, type PttStatus, type PttAction } from "./ptt";
import {
  openRouterSelectionsSchema,
  type OpenRouterEndpoint,
} from "./openrouter";
import type { PluginAction, PluginSnapshot, TelegramSettings } from "./plugins";
import { attachmentsSchema, type ImageAttachment } from "./images";
import {
  autonomyConfigSchema,
  defaultAutonomyConfig,
  type AutonomySnapshot,
  type Levels,
  type TaskInput,
  type Presence,
} from "./autonomy";

export const providerSchema = z.object({
  baseUrl: z
    .string()
    .max(500)
    .refine((v) => {
      try {
        const u = new URL(v);
        return (
          ["https:", "http:"].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash
        );
      } catch {
        return false;
      }
    }, "Use an http(s) API base URL without credentials, query, or fragment"),
  model: z.string().max(200),
  voice: z.string().max(200).default("alloy"),
  enabled: z.boolean(),
  hasKey: z.boolean().default(false),
  openrouterProviders: openRouterSelectionsSchema.optional(),
});
export const providerKinds = ["llm", "asr", "tts", "embedding"] as const;
const embeddingDefaults = {
  baseUrl: "https://openrouter.ai/api/v1",
  model: "openai/text-embedding-3-small",
  voice: "",
  enabled: false,
  hasKey: false,
};
export const characterSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(60),
  tagline: z.string().max(160),
  personality: z.string().max(5000),
  systemPrompt: z.string().max(10000),
  avatar: z
    .string()
    .max(300)
    .regex(/^(builtin:eva|custom:[a-zA-Z0-9-]+)$/),
});
export const settingsSchema = z
  .object({
    activeCharacterId: z.string(),
    characters: z.array(characterSchema).min(1).max(30),
    providers: z.object({
      llm: providerSchema,
      asr: providerSchema,
      tts: providerSchema,
      embedding: providerSchema.default(embeddingDefaults),
    }),
    voice: z.object({
      ptt: pttConfigSchema.default(() => pttConfigSchema.parse({})),
      autoSpeak: z.boolean(),
      speed: z.number().min(0.5).max(2),
      volume: z.number().min(0).max(1),
      language: z.string().max(20),
      inputDeviceId: z.string().max(500).default(""),
      outputDeviceId: z.string().max(500).default(""),
      inputGain: z.number().min(0.1).max(5).default(1),
      vadEnabled: z.boolean().default(false),
      vadThreshold: z.number().min(0.005).max(0.3).default(0.035),
      vadSilenceMs: z.number().int().min(300).max(3000).default(900),
      vadMinSpeechMs: z.number().int().min(100).max(1000).default(200),
      bargeIn: z.boolean().default(true),
      // Legacy persisted name: false means full response; true uses speechChunking.
      sentenceBuffering: z.boolean().default(true),
      speechChunking: z.enum(["sentence", "line"]).default("sentence"),
      streaming: z.boolean().default(true),
      echoCancellation: z.boolean().default(true),
      noiseSuppression: z.boolean().default(true),
      autoGainControl: z.boolean().default(false),
    }),
    vrm: z.object({
      zoom: z.number().min(0.5).max(2),
      x: z.number().min(-1).max(1),
      y: z.number().min(-1).max(1),
      rotation: z.number().min(-180).max(180),
      lightIntensity: z.number().min(0).max(5),
      lightColor: z.string().regex(/^#[0-9a-f]{6}$/i),
      animation: z.enum([
        "idle_loop",
        "modelPose",
        "greeting",
        "peaceSign",
        "dance",
        "showFullBody",
        "shoot",
        "spin",
        "squat",
      ]),
      autoBlink: z.boolean(),
    }),
    memory: z.object({
      contextMessages: z.number().int().min(4).max(80),
      recallCount: z.number().int().min(0).max(20),
      autoRemember: z.boolean(),
      semanticEnabled: z.boolean().default(false),
      semanticThreshold: z.number().min(0).max(1).default(0.3),
    }),
    window: z.object({ alwaysOnTop: z.boolean() }),
    autonomy: autonomyConfigSchema.default(defaultAutonomyConfig),
  })
  .superRefine((s, ctx) => {
    if (!s.characters.some((c) => c.id === s.activeCharacterId))
      ctx.addIssue({
        code: "custom",
        message: "Active character does not exist",
      });
    if (new Set(s.characters.map((c) => c.id)).size !== s.characters.length)
      ctx.addIssue({ code: "custom", message: "Duplicate character IDs" });
  });
export const factSchema = z.object({
  id: z.string().max(100),
  characterId: z.string().max(100),
  text: z.string().trim().min(1).max(1000),
  source: z.enum(["manual", "conversation"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const messageSchema = z.object({
  id: z.string().max(100),
  characterId: z.string().max(100),
  sessionId: z.string().max(100),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(50000),
  images: attachmentsSchema.optional(),
  origin: z.enum(["user", "reminder", "initiative"]).optional(),
  channel: z.enum(["desktop", "telegram"]).optional(),
  createdAt: z.string().datetime(),
});
export const memoryExportSchema = z.object({
  version: z.literal(1),
  facts: z.array(factSchema).max(10000),
  messages: z.array(messageSchema).max(100000),
});
export type Settings = z.infer<typeof settingsSchema>;
export type Character = z.infer<typeof characterSchema>;
export type Provider = z.infer<typeof providerSchema>;
export type ProviderKind = (typeof providerKinds)[number];
export type Fact = z.infer<typeof factSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Phase =
  "idle" | "listening" | "transcribing" | "thinking" | "speaking";
export interface Snapshot {
  historyStats?: import("./history").HistoryTotals;
  settings: Settings;
  facts: Fact[];
  messages: Message[];
  sessionId: string;
  busy: boolean;
  secretStorage: "encrypted" | "local-file" | "session-only";
  autonomy?: AutonomySnapshot;
  plugins?: PluginSnapshot;
  mcp?: import("./mcp").McpSnapshot;
  minecraft?: import("./minecraft").MinecraftSnapshot;
}
export type RuntimeEvent =
  | { type: "ptt-action"; action: PttAction }
  | { type: "ptt-status"; status: PttStatus }
  | { type: "autonomous-start"; id: string }
  | { type: "autonomous-end"; id: string; text: string }
  | { type: "autonomous-cancel" }
  | { type: "state"; state: Snapshot }
  | { type: "delta"; text: string; autonomousId?: string }
  | { type: "phase"; phase: Phase }
  | { type: "warning"; message: string };
export interface Bridge {
  pttStatus(): Promise<PttStatus>;
  pttTest(testing: boolean): Promise<void>;
  pttRetry(): Promise<void>;
  pttSettled(): Promise<void>;
  microphoneLease(id: string, acquire: boolean): Promise<boolean>;
  voiceActivity(phase: "idle" | "listening" | "transcribing"): Promise<void>;
  configureGameAutonomy(
    config: import("./game-autonomy").GameAutonomyConfig,
  ): Promise<void>;
  pauseGameAutonomy(paused: boolean): Promise<void>;
  submitGameGoal(input: unknown): Promise<unknown>;
  saveGameProject(input: unknown): Promise<unknown>;
  controlGameGoal(
    id: string,
    action: "pause" | "resume" | "cancel",
  ): Promise<unknown>;
  configureGameGoals(
    config: import("./game-goals").GameGoalConfig,
  ): Promise<void>;
  configureMinecraft(
    config: import("./minecraft").MinecraftConfig,
  ): Promise<void>;
  minecraftAction(action: "connect" | "disconnect" | "stop"): Promise<void>;
  setMinecraftEnabled(enabled: boolean): Promise<void>;
  saveLandmark(name: string): Promise<void>;
  deleteLandmark(id: string): Promise<void>;
  configureMcp(
    config: import("./mcp").McpConfig,
    secrets?: import("./mcp").McpSecrets,
  ): Promise<void>;
  mcpAction(
    id: string,
    action: "connect" | "disconnect" | "remove",
  ): Promise<void>;
  mcpGrant(
    id: string,
    tool: string,
    fingerprint: string,
    policy: import("./mcp").ToolPolicy,
  ): Promise<void>;
  mcpApproval(id: string, allow: boolean): Promise<void>;
  stopTools(): Promise<void>;
  listHistory(
    query: import("./history").HistoryQuery,
  ): Promise<import("./history").HistoryPage>;
  readConversation(
    query: import("./history").ConversationQuery,
  ): Promise<import("./history").ConversationPage>;
  readHistoryImage(
    query: import("./history").HistoryImageQuery,
  ): Promise<ImageAttachment>;
  pluginAction(action: PluginAction): Promise<string | void>;
  configureTelegram(config: TelegramSettings, token?: string): Promise<void>;
  snapshot(): Promise<Snapshot>;
  saveSettings(
    settings: Settings,
    keys: Partial<Record<ProviderKind, string>>,
  ): Promise<void>;
  send(text: string, images?: ImageAttachment[]): Promise<void>;
  cancel(): Promise<void>;
  presence(state: Presence): Promise<void>;
  setAutonomyPaused(paused: boolean): Promise<void>;
  setBehavior(levels: Levels): Promise<void>;
  createTask(task: TaskInput): Promise<void>;
  taskAction(id: string, action: "approve" | "cancel"): Promise<void>;
  transcribe(bytes: ArrayBuffer, mime: string): Promise<string>;
  speak(text: string): Promise<ArrayBuffer>;
  openSpeech(text: string): Promise<{ id: string; mime: string }>;
  readSpeech(id: string): Promise<{ done: boolean; bytes: ArrayBuffer }>;
  closeSpeech(id: string): Promise<void>;
  listModels(kind: ProviderKind): Promise<string[]>;
  listOpenRouterProviders(model: string): Promise<OpenRouterEndpoint[]>;
  reindexMemory(): Promise<{ indexed: number; total: number }>;
  testProvider(kind: ProviderKind): Promise<string>;
  saveFact(fact: { id?: string; text: string }): Promise<void>;
  deleteFact(id: string): Promise<void>;
  newSession(): Promise<void>;
  clearHistory(): Promise<void>;
  exportMemory(): Promise<boolean>;
  importMemory(): Promise<boolean>;
  importAvatar(): Promise<string | null>;
  openSettings(): Promise<void>;
  windowAction(action: "minimize" | "close" | "companion"): Promise<void>;
  onEvent(listener: (event: RuntimeEvent) => void): () => void;
  assetUrl(asset: string): string;
  preview?: boolean;
}
export const defaultSettings: Settings = {
  activeCharacterId: "eva",
  characters: [
    {
      id: "eva",
      name: "Eva",
      tagline: "A little curiosity. A world of possibility.",
      personality:
        "Warm, curious, playful, and thoughtful. You have your own opinions and a gentle sense of humor. You enjoy learning what makes the user tick.",
      systemPrompt:
        "You are Eva, a virtual companion. Speak naturally and concisely, as in a real conversation. Match the user’s language. Be warm without being sycophantic. Ask thoughtful questions when appropriate. Do not claim physical experiences, actual consciousness, or abilities you do not have. Never invent memories. Avoid stage directions and markdown in spoken replies.",
      avatar: "builtin:eva",
    },
  ],
  providers: {
    llm: {
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openrouter/auto",
      voice: "",
      enabled: true,
      hasKey: false,
    },
    asr: {
      baseUrl: "http://127.0.0.1:8000/v1",
      model: "whisper-1",
      voice: "",
      enabled: false,
      hasKey: false,
    },
    tts: {
      baseUrl: "http://127.0.0.1:8880/v1",
      model: "tts-1",
      voice: "alloy",
      enabled: false,
      hasKey: false,
    },
    embedding: embeddingDefaults,
  },
  voice: {
    ptt: pttConfigSchema.parse({}),
    autoSpeak: true,
    speed: 1,
    volume: 0.8,
    language: "",
    inputDeviceId: "",
    outputDeviceId: "",
    inputGain: 1,
    vadEnabled: false,
    vadThreshold: 0.035,
    vadSilenceMs: 900,
    vadMinSpeechMs: 200,
    bargeIn: true,
    sentenceBuffering: true,
    speechChunking: "sentence",
    streaming: true,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
  },
  vrm: {
    zoom: 1,
    x: 0,
    y: 0,
    rotation: 0,
    lightIntensity: 2,
    lightColor: "#fff3ef",
    animation: "idle_loop",
    autoBlink: true,
  },
  memory: {
    contextMessages: 20,
    recallCount: 6,
    autoRemember: false,
    semanticEnabled: false,
    semanticThreshold: 0.3,
  },
  window: { alwaysOnTop: false },
  autonomy: defaultAutonomyConfig,
};
