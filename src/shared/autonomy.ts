import { z } from "zod";

export const timeZoneSchema = z
  .string()
  .max(100)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, "Use an IANA time zone, e.g. Europe/Moscow.");
export const dimensions = [
  "mood",
  "boredom",
  "energy",
  "trust",
  "affinity",
] as const;
export const levelsSchema = z.object({
  mood: z.number().min(0).max(100),
  boredom: z.number().min(0).max(100),
  energy: z.number().min(0).max(100),
  trust: z.number().min(0).max(100),
  affinity: z.number().min(0).max(100),
});
export const autonomyConfigSchema = z.object({
  enabled: z.boolean().default(false),
  proactive: z.boolean().default(false),
  schedulingTools: z.boolean().default(false),
  paused: z.boolean().default(false),
  initiative: z.number().min(0).max(100).default(40),
  idleMinutes: z.number().int().min(1).max(1440).default(20),
  cooldownMinutes: z.number().int().min(1).max(1440).default(30),
  dailyBudget: z.number().int().min(0).max(100).default(5),
  quietEnabled: z.boolean().default(true),
  quietStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("23:00"),
  quietEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("08:00"),
  timeZone: timeZoneSchema.default("UTC"),
  overdueHours: z.number().int().min(1).max(168).default(24),
  expressive: z.boolean().default(true),
  floor: z.number().min(0).max(49).default(0),
  ceiling: z.number().min(51).max(100).default(100),
});
export const defaultAutonomyConfig = autonomyConfigSchema.parse({});
export type AutonomyConfig = z.infer<typeof autonomyConfigSchema>;
export type Levels = z.infer<typeof levelsSchema>;
export const behaviorSchema = levelsSchema.extend({
  updatedAt: z.number(),
  lastInteraction: z.number(),
  lastAction: z.number().default(0),
  day: z.string().default(""),
  dailyUsed: z.number().int().min(0).default(0),
  reason: z.string().max(500),
});
export type BehaviorState = z.infer<typeof behaviorSchema>;
export function initialBehavior(now: number): BehaviorState {
  return {
    mood: 60,
    boredom: 0,
    energy: 70,
    trust: 20,
    affinity: 20,
    updatedAt: now,
    lastInteraction: now,
    lastAction: 0,
    day: "",
    dailyUsed: 0,
    reason: "Initial neutral, curious state.",
  };
}
export const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  intent: z.string().trim().min(1).max(1000),
  dueAt: z.string().datetime({ offset: true }),
  timeZone: timeZoneSchema,
});
export type TaskInput = z.infer<typeof taskInputSchema>;
export const taskSchema = taskInputSchema.extend({
  id: z.string().uuid(),
  characterId: z.string(),
  status: z.enum([
    "approval",
    "pending",
    "running",
    "done",
    "cancelled",
    "missed",
    "failed",
  ]),
  source: z.enum(["user", "llm"]),
  createdAt: z.string().datetime(),
  outcome: z.string().max(500).default(""),
});
export type ScheduledTask = z.infer<typeof taskSchema>;
export const activitySchema = z.object({
  id: z.string().uuid(),
  characterId: z.string(),
  at: z.string().datetime(),
  kind: z.string().max(60),
  detail: z.string().max(1000),
  requests: z.number().int().min(0).default(0),
  tokens: z.number().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
});
export type Activity = z.infer<typeof activitySchema>;
export const automationSchema = z.object({
  states: z.record(z.string(), behaviorSchema).default({}),
  tasks: z.array(taskSchema).max(2000).default([]),
  activity: z.array(activitySchema).max(500).default([]),
});
export const presenceSchema = z.object({
  blocked: z.boolean(),
  visible: z.boolean(),
});
export type Presence = z.infer<typeof presenceSchema>;
export interface AutonomySnapshot {
  state: BehaviorState;
  tasks: ScheduledTask[];
  activity: Activity[];
  gate: string;
}
