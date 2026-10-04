import { randomUUID } from "node:crypto";
import {
  gameAutonomyConfigSchema,
  gameUsage,
  type GameAutonomyState,
} from "../src/shared/game-autonomy";
import type { GameGoal } from "../src/shared/game-goals";
import type { MinecraftLive } from "../src/shared/minecraft";
import type { CompanionRuntime } from "./runtime";

/** Durable policy, accounting and world notes; never owns a Minecraft action. */
export class GameDirector {
  constructor(private runtime: CompanionRuntime) {
    this.change((s) => {
      s.session = { requests: 0, tokens: 0, cost: 0 };
      s.nextDecisionAt = 0;
      s.detail =
        "Join a world manually to begin. Saved actions are not replayed.";
    });
  }
  get state() {
    return this.runtime.store.data.minecraft.autonomy;
  }
  get config() {
    return this.state.config;
  }
  change(fn: (s: GameAutonomyState) => void) {
    this.runtime.store.update((d) => fn(d.minecraft.autonomy));
    this.runtime.broadcast();
  }
  configure(raw: unknown) {
    const config = gameAutonomyConfigSchema.parse(raw);
    this.change((s) => {
      s.config = config;
      s.nextDecisionAt = 0;
      s.failures = 0;
    });
  }
  waiting(detail: string, seconds = this.config.intervalSeconds) {
    this.change((s) => {
      s.detail = detail.slice(0, 600);
      s.nextDecisionAt = Date.now() + seconds * 1000;
    });
  }
  failure(detail: string) {
    this.change((s) => {
      s.failures = Math.min(10, s.failures + 1);
    });
    this.waiting(
      detail,
      Math.min(
        1800,
        Math.max(this.config.intervalSeconds, 30) *
          2 ** (this.state.failures - 1),
      ),
    );
  }
  budget(afterResponse = false) {
    const hour = gameUsage(this.state),
      session = this.state.session,
      c = this.config;
    if (
      (!afterResponse && session.requests >= c.sessionRequests) ||
      session.tokens >= c.sessionTokens ||
      session.cost >= c.sessionCost
    )
      return "Application-session game budget reached. Adjust the game budget to continue.";
    if (
      (!afterResponse && hour.requests >= c.hourlyRequests) ||
      hour.tokens >= c.hourlyTokens ||
      hour.cost >= c.hourlyCost
    )
      return "Rolling-hour game budget reached; waiting for usage to expire.";
    return "";
  }
  reserve() {
    const blocked = this.budget();
    if (blocked) throw new Error(blocked);
    const id = randomUUID();
    this.change((s) => {
      s.charges = s.charges.filter((v) => v.at > Date.now() - 3600000);
      s.charges.push({ id, at: Date.now(), requests: 1, tokens: 0, cost: 0 });
      s.session.requests++;
    });
    return (usage: { tokens?: number; cost?: number }) =>
      this.change((s) => {
        const entry = s.charges.find((v) => v.id === id);
        const tokens = Math.max(0, usage.tokens ?? 0),
          cost = Math.max(0, usage.cost ?? 0);
        if (entry) {
          entry.tokens += tokens;
          entry.cost += cost;
        }
        s.session.tokens += tokens;
        s.session.cost += cost;
      });
  }
  remember(g: GameGoal, live: MinecraftLive) {
    if (g.status !== "completed" && g.status !== "failed") return;
    const status = g.status;
    this.change((s) => {
      s.memories = [
        ...s.memories.slice(-79),
        {
          world: g.world,
          characterId: g.characterId,
          observedAt: new Date().toISOString(),
          objective: g.objective,
          outcome: g.detail,
          status,
          inventory: live.inventory
            .slice(0, 100)
            .map(({ name, count }) => ({ name, count })),
          position: live.position,
        },
      ];
      if (status === "completed") s.failures = 0;
    });
    if (status === "failed") this.failure(g.detail);
    else
      this.waiting("Verified outcome saved. Choosing the next activity soon.");
  }
}
