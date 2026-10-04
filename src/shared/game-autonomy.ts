import { z } from "zod";
import { goalConditionSchema } from "./game-goals";

export const gameAutonomyConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    paused: z.boolean().default(false),
    preference: z.enum(["free", "help", "objective"]).default("free"),
    objective: z.string().trim().max(1000).default(""),
    intervalSeconds: z.number().int().min(10).max(3600).default(30),
    hourlyRequests: z.number().int().min(0).max(1000).default(120),
    hourlyTokens: z.number().int().min(0).max(10000000).default(200000),
    hourlyCost: z.number().min(0).max(100).default(2),
    sessionRequests: z.number().int().min(0).max(10000).default(500),
    sessionTokens: z.number().int().min(0).max(100000000).default(1000000),
    sessionCost: z.number().min(0).max(1000).default(10),
    notify: z.boolean().default(false),
  })
  .strict();
const usageSchema = z.object({
  requests: z.number().nonnegative().default(0),
  tokens: z.number().nonnegative().default(0),
  cost: z.number().nonnegative().default(0),
});
export const gameAutonomyStateSchema = z.object({
  config: gameAutonomyConfigSchema.default(() =>
    gameAutonomyConfigSchema.parse({}),
  ),
  detail: z.string().max(600).default("Independent gameplay is off."),
  nextDecisionAt: z.number().default(0),
  failures: z.number().int().min(0).max(10).default(0),
  // Rolling hour survives restarts; session totals span the application's lifetime.
  charges: z
    .array(usageSchema.extend({ id: z.string(), at: z.number() }))
    .max(2000)
    .default([]),
  session: usageSchema.default(() => usageSchema.parse({})),
  memories: z
    .array(
      z.object({
        world: z.string(),
        characterId: z.string(),
        observedAt: z.string(),
        objective: z.string().max(600),
        outcome: z.string().max(600),
        status: z.enum(["completed", "failed"]),
        inventory: z
          .array(z.object({ name: z.string(), count: z.number() }))
          .max(100),
        position: z
          .object({ x: z.number(), y: z.number(), z: z.number() })
          .optional(),
      }),
    )
    .max(80)
    .default([]),
});
export const directorDecisionSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("goal"),
      objective: z.string().trim().min(1).max(600),
      completion: z.array(goalConditionSchema).min(1).max(8),
    })
    .strict(),
  z
    .object({
      decision: z.literal("wait"),
      seconds: z.number().int().min(10).max(3600),
      reason: z.string().min(1).max(400),
    })
    .strict(),
]);
export type GameAutonomyConfig = z.infer<typeof gameAutonomyConfigSchema>;
export type GameAutonomyState = z.infer<typeof gameAutonomyStateSchema>;
export function gameUsage(state: GameAutonomyState, now = Date.now()) {
  return state.charges
    .filter((v) => v.at > now - 3600000)
    .reduce(
      (a, v) => ({
        requests: a.requests + v.requests,
        tokens: a.tokens + v.tokens,
        cost: a.cost + v.cost,
      }),
      { requests: 0, tokens: 0, cost: 0 },
    );
}
