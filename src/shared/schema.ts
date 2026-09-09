import { z } from "zod";

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
});
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
    }),
    voice: z.object({
      autoSpeak: z.boolean(),
      speed: z.number().min(0.5).max(2),
      volume: z.number().min(0).max(1),
      language: z.string().max(20),
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
    }),
    window: z.object({ alwaysOnTop: z.boolean() }),
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
export type ProviderKind = "llm" | "asr" | "tts";
export type Fact = z.infer<typeof factSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Phase =
  "idle" | "listening" | "transcribing" | "thinking" | "speaking";
export interface Snapshot {
  settings: Settings;
  facts: Fact[];
  messages: Message[];
  sessionId: string;
  busy: boolean;
  secretStorage: "encrypted" | "session-only";
}
export type RuntimeEvent =
  | { type: "state"; state: Snapshot }
  | { type: "delta"; text: string }
  | { type: "phase"; phase: Phase }
  | { type: "warning"; message: string };
export interface Bridge {
  snapshot(): Promise<Snapshot>;
  saveSettings(
    settings: Settings,
    keys: Partial<Record<ProviderKind, string>>,
  ): Promise<void>;
  send(text: string): Promise<void>;
  cancel(): Promise<void>;
  transcribe(bytes: ArrayBuffer, mime: string): Promise<string>;
  speak(text: string): Promise<ArrayBuffer>;
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
  },
  voice: { autoSpeak: true, speed: 1, volume: 0.8, language: "" },
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
  memory: { contextMessages: 20, recallCount: 6, autoRemember: false },
  window: { alwaysOnTop: false },
};
