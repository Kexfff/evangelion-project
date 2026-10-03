import { z } from "zod";

const point = z
  .object({
    x: z.number().min(-30000000).max(30000000),
    y: z.number().min(-2048).max(2048),
    z: z.number().min(-30000000).max(30000000),
  })
  .strict();
export const goalConditionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("inventory"),
      item: z.string().regex(/^[a-z0-9_]{1,100}$/),
      count: z.number().int().min(1).max(4096),
    })
    .strict(),
  z
    .object({
      kind: z.literal("position"),
      position: point,
      radius: z.number().min(1).max(16).default(3),
    })
    .strict(),
  z
    .object({
      kind: z.literal("block"),
      position: point.extend({
        x: point.shape.x.int(),
        y: point.shape.y.int(),
        z: point.shape.z.int(),
      }),
      block: z.string().regex(/^[a-z0-9_]{1,100}$/),
    })
    .strict(),
  z
    .object({ kind: z.literal("food"), minimum: z.number().min(1).max(20) })
    .strict(),
]);
export const goalInputSchema = z
  .object({
    objective: z.string().trim().min(1).max(600),
    completion: z.array(goalConditionSchema).min(1).max(8),
    mode: z.enum(["queue", "replace"]).default("queue"),
    dueAt: z.string().datetime().optional(),
  })
  .strict();
export const gameGoalConfigSchema = z
  .object({
    maxSteps: z.number().int().min(1).max(64).default(24),
    maxRequests: z.number().int().min(1).max(100).default(32),
    maxMinutes: z.number().int().min(1).max(120).default(15),
    stepSeconds: z.number().int().min(10).max(300).default(90),
    maxCost: z.number().min(0).max(50).default(0.5),
    scheduled: z.boolean().default(false),
    survival: z.boolean().default(false),
    notify: z.boolean().default(false),
    reactionCooldownSeconds: z.number().int().min(30).max(3600).default(120),
  })
  .strict();
export const gameGoalSchema = z.object({
  id: z.string().uuid(),
  objective: z.string().max(600),
  completion: z.array(goalConditionSchema).min(1).max(8),
  status: z.enum([
    "queued",
    "running",
    "paused",
    "completed",
    "failed",
    "cancelled",
  ]),
  source: z.enum(["desktop", "telegram", "survival"]),
  characterId: z.string(),
  sessionId: z.string(),
  world: z.string(),
  dueAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  detail: z.string().max(600),
  steps: z.number().int().default(0),
  requests: z.number().int().default(0),
  cost: z.number().nonnegative().default(0),
  tokens: z.number().nonnegative().default(0),
  elapsedMs: z.number().nonnegative().default(0),
  recoveries: z.number().int().min(0).max(2).default(0),
  history: z
    .array(
      z.object({
        tool: z.string().max(128),
        args: z.record(z.string(), z.unknown()),
        outcome: z.string().max(600),
      }),
    )
    .max(64)
    .default([]),
  currentTool: z.string().optional(),
  jobId: z.string().optional(),
  wakeAt: z.number().optional(),
});
export type GameGoal = z.infer<typeof gameGoalSchema>;
export type GameGoalConfig = z.infer<typeof gameGoalConfigSchema>;
export type GoalCondition = z.infer<typeof goalConditionSchema>;
export const goalControlSchema = z
  .object({
    id: z.string().uuid(),
    action: z.enum(["pause", "resume", "cancel"]),
  })
  .strict();
export const plannerDecisionSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("step"),
      tool: z.string().min(1).max(128),
      args: z.record(z.string(), z.unknown()),
      reason: z.string().max(400),
    })
    .strict(),
  z
    .object({
      decision: z.literal("blocked"),
      reason: z.string().min(1).max(400),
    })
    .strict(),
  z
    .object({
      decision: z.literal("wait"),
      seconds: z.number().int().min(1).max(60),
      reason: z.string().max(400),
    })
    .strict(),
]);
function definition(name: string, description: string, schema: z.ZodType) {
  const { $schema, ...parameters } = z.toJSONSchema(schema);
  return { type: "function", function: { name, description, parameters } };
}
export const gameGoalTools = [
  definition(
    "game_goal",
    "Start a persistent Minecraft goal for this user's request. Define observable completion criteria; queue by default, replace only when requested. Continues after this chat turn, verifies each action. dueAt schedules only when game scheduling is enabled. Do not narrate bookkeeping or invent completion.",
    goalInputSchema,
  ),
  definition(
    "game_goal_control",
    "Pause, explicitly resume/reconcile, or cancel a Minecraft goal requested by this user.",
    goalControlSchema,
  ),
];
