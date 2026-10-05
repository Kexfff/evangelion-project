import { z } from "zod";

export const approachDiagnosticSchema = z.object({
  position: z.object({
    x: z.number().int().min(-30000000).max(30000000),
    y: z.number().int().min(-2048).max(2048),
    z: z.number().int().min(-30000000).max(30000000),
  }),
  startedAt: z.string().datetime(),
  elapsedMs: z.number().nonnegative(),
  outcome: z.enum([
    "approaching",
    "reached",
    "no_path",
    "search_timeout",
    "interaction_blocked",
    "target_changed",
    "unloaded",
    "interrupted",
    "failed",
  ]),
});
export type ApproachDiagnostic = z.infer<typeof approachDiagnosticSchema>;
export const approachLabels: Record<ApproachDiagnostic["outcome"], string> = {
  approaching: "Looking for an approach",
  reached: "Reached within range and line of sight",
  no_path: "Pathfinder found no route",
  search_timeout: "Path search timed out",
  interaction_blocked: "Route ended out of reach or without line of sight",
  target_changed: "The block is no longer a crafting table",
  unloaded: "The block is no longer loaded",
  interrupted: "Stopped before approach completed",
  failed: "Approach stopped; see the action error",
};
