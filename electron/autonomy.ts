import { randomUUID } from "node:crypto";
import { Store } from "./store";
import type { CompanionEvent } from "../src/shared/plugins";
import {
  initialBehavior,
  taskInputSchema,
  levelsSchema,
  type AutonomyConfig,
  type BehaviorState,
  type Levels,
  type ScheduledTask,
  type TaskInput,
  type Activity,
  type Presence,
} from "../src/shared/autonomy";

export function localClock(now: number, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}
export function quietNow(now: number, cfg: AutonomyConfig) {
  if (!cfg.quietEnabled) return false;
  const time = localClock(now, cfg.timeZone).time;
  return (
    cfg.quietStart === cfg.quietEnd ||
    (cfg.quietStart < cfg.quietEnd
      ? time >= cfg.quietStart && time < cfg.quietEnd
      : time >= cfg.quietStart || time < cfg.quietEnd)
  );
}
export function evolve(
  state: BehaviorState,
  now: number,
  cfg: AutonomyConfig,
  interaction = false,
): BehaviorState {
  const minutes = Math.max(0, Math.min(360, (now - state.updatedAt) / 60000));
  const next = { ...state, updatedAt: now };
  next.boredom += minutes * 0.15;
  next.mood += (60 - next.mood) * Math.min(1, minutes / 180);
  next.energy += minutes * (quietNow(now, cfg) ? 0.12 : -0.02);
  if (interaction) {
    next.boredom -= 20;
    next.mood += 2;
    next.energy -= 1;
    // Cap relationship growth to one increment per minute; absence never penalizes it.
    if (now - state.lastInteraction >= 60000) {
      next.trust += 0.2;
      next.affinity += 0.3;
    }
    next.lastInteraction = now;
  }
  for (const key of ["mood", "boredom", "energy", "trust", "affinity"] as const)
    next[key] = Math.min(cfg.ceiling, Math.max(cfg.floor, next[key]));
  next.reason = interaction
    ? "User interaction: boredom −20, mood +2, energy −1; relationship grows at most once/minute."
    : "Idle: boredom +0.15/min, mood tends toward 60, energy recovers in quiet hours. Offline drift capped at 6h.";
  return next;
}

/** One durable, bounded scheduler. Only chat output is permitted in sprint 2. */
export class Autonomy {
  private inTick = false;
  private presence: Presence = { blocked: true, visible: false };
  private heartbeat = 0;
  private suspended = false;
  private lastGate = "";
  constructor(
    readonly store: Store,
    private busy: () => boolean,
    private deliver: (task?: ScheduledTask) => Promise<void>,
    private changed: () => void,
    readonly now: () => number = Date.now,
    private remoteAvailable: () => boolean = () => false,
  ) {
    this.store.update((d) => {
      for (const task of d.automation.tasks)
        if (task.status === "running") {
          task.status = "failed";
          task.outcome =
            "Interrupted by restart; not replayed automatically to avoid duplicates.";
        }
    });
  }
  get config() {
    return this.store.data.settings.autonomy;
  }
  get state() {
    return (
      this.store.data.automation.states[this.store.characterId] ??
      initialBehavior(this.now())
    );
  }
  setPresence(value: Presence) {
    this.presence = value;
    this.heartbeat = this.now();
  }
  suspend(value: boolean) {
    this.suspended = value;
    this.heartbeat = 0;
  }
  get gameSuspended() {
    return this.suspended;
  }
  reserveGameAction() {
    if (this.gate() !== "Ready")
      throw new Error("Autonomous game action is not ready.");
    this.store.update((d) => {
      const state = { ...this.state },
        day = localClock(this.now(), this.config.timeZone).day;
      state.dailyUsed = state.day === day ? state.dailyUsed + 1 : 1;
      state.day = day;
      state.lastAction = this.now();
      d.automation.states[this.store.characterId] = state;
    });
    this.log("game-wake", "Authorized game goal claimed an autonomy action.");
  }
  log(
    kind: string,
    detail: string,
    extra: Partial<Pick<Activity, "requests" | "tokens" | "cost">> = {},
    characterId = this.store.characterId,
  ) {
    this.store.update((d) => {
      d.automation.activity.push({
        id: randomUUID(),
        characterId,
        at: new Date(this.now()).toISOString(),
        kind,
        detail: detail.slice(0, 1000),
        requests: 0,
        ...extra,
      });
      d.automation.activity = d.automation.activity.slice(-500);
    });
  }
  interaction() {
    this.store.update((d) => {
      d.automation.states[this.store.characterId] = evolve(
        this.state,
        this.now(),
        this.config,
        true,
      );
    });
  }
  /** Trusted internal event ingress for the future permissioned plugin host. */
  observe(event: CompanionEvent) {
    if (event.characterId !== this.store.characterId) return;
    if (event.type === "message:received" || event.type === "session:started")
      this.interaction();
    if (event.type === "session:started")
      this.log(
        "session",
        "New conversation; pending reminders remain scoped to this character.",
      );
  }
  setBehavior(value: Levels) {
    const levels = levelsSchema.parse(value);
    for (const v of Object.values(levels))
      if (v < this.config.floor || v > this.config.ceiling)
        throw new Error("Values must stay within configured state bounds.");
    this.store.update((d) => {
      d.automation.states[this.store.characterId] = {
        ...this.state,
        ...levels,
        updatedAt: this.now(),
        reason: "State edited by the user.",
      };
    });
    this.log("state", "Behavior values edited by the user.");
    this.changed();
  }
  createTask(raw: TaskInput, source: "user" | "llm" = "user") {
    const input = taskInputSchema.parse(raw);
    const due = Date.parse(input.dueAt);
    if (due <= this.now() || due > this.now() + 366 * 86400000)
      throw new Error(
        "Choose a future time within one year, with an explicit UTC offset.",
      );
    if (this.store.data.automation.tasks.length >= 2000)
      throw new Error(
        "Task archive is full (2000); archive management is required before adding more tasks.",
      );
    const task: ScheduledTask = {
      ...input,
      dueAt: new Date(due).toISOString(),
      id: randomUUID(),
      characterId: this.store.characterId,
      source,
      status: source === "llm" ? "approval" : "pending",
      createdAt: new Date(this.now()).toISOString(),
      outcome:
        source === "llm"
          ? "Awaiting user approval in Consciousness settings."
          : "Authorized by user.",
    };
    this.store.update((d) => {
      d.automation.tasks.push(task);
    });
    this.log(
      "task-created",
      `${task.title}: ${task.status}; due ${task.dueAt} (${task.timeZone}); ID ${task.id}`,
    );
    this.changed();
    return task;
  }
  taskAction(id: string, action: "approve" | "cancel") {
    const task = this.store.data.automation.tasks.find(
      (t) => t.id === id && t.characterId === this.store.characterId,
    );
    if (!task) throw new Error("Task not found for this character.");
    if (action === "approve" && task.status !== "approval")
      throw new Error("Task is not awaiting approval.");
    if (
      action === "cancel" &&
      !["approval", "pending", "running"].includes(task.status)
    )
      throw new Error("Task is already finished.");
    this.store.update((d) => {
      const t = d.automation.tasks.find((t) => t.id === id)!;
      t.status = action === "approve" ? "pending" : "cancelled";
      t.outcome =
        action === "approve"
          ? "Authorized by user."
          : "Cancelled by user/tool request.";
    });
    this.log(`task-${action}`, `${task.title} (${id})`);
    this.changed();
  }
  gate(now = this.now()) {
    const cfg = this.config;
    if (!cfg.enabled) return "Autonomy is off";
    if (cfg.paused) return "Paused by user";
    if (this.suspended) return "System suspended or locked";
    const freshPresence = !!this.heartbeat && now - this.heartbeat <= 6500;
    const desktopAvailable = this.presence.visible && freshPresence;
    if (!desktopAvailable && !this.remoteAvailable())
      return "Companion unavailable";
    if ((freshPresence && this.presence.blocked) || this.busy())
      return "User, speech or another action is busy";
    if (quietNow(now, cfg)) return "Quiet hours";
    if (!this.store.data.settings.providers.llm.enabled)
      return "LLM provider disabled";
    if (
      this.state.day === localClock(now, cfg.timeZone).day &&
      this.state.dailyUsed >= cfg.dailyBudget
    )
      return "Daily action budget reached";
    if (cfg.dailyBudget === 0) return "Daily action budget reached";
    if (now - this.state.lastAction < cfg.cooldownMinutes * 60000)
      return "Cooldown";
    if (now - this.state.lastInteraction < 10000)
      return "User interaction grace period";
    return "Ready";
  }
  snapshot() {
    return {
      state: this.state,
      tasks: this.store.data.automation.tasks.filter(
        (t) => t.characterId === this.store.characterId,
      ),
      activity: this.store.data.automation.activity
        .filter((e) => e.characterId === this.store.characterId)
        .slice(-100)
        .reverse(),
      gate: this.gate(),
    };
  }
  async tick() {
    if (this.inTick) return;
    this.inTick = true;
    try {
      const now = this.now(),
        characterId = this.store.characterId;
      if (
        !this.store.data.automation.states[characterId] ||
        now - this.state.updatedAt >= 60000
      ) {
        this.store.update((d) => {
          d.automation.states[characterId] = evolve(
            this.state,
            now,
            this.config,
          );
        });
        this.changed();
      }
      const gate = this.gate(now);
      if (gate !== this.lastGate) {
        this.lastGate = gate;
        this.log("policy", gate);
        this.changed();
      }
      if (gate !== "Ready") return;
      const due = this.store.data.automation.tasks
        .filter(
          (t) =>
            t.characterId === characterId &&
            t.status === "pending" &&
            Date.parse(t.dueAt) <= now,
        )
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
      for (const task of due.filter(
        (t) => now - Date.parse(t.dueAt) > this.config.overdueHours * 3600000,
      )) {
        this.finish(
          task.id,
          "missed",
          "Overdue beyond configured catch-up window.",
        );
      }
      const task = due.find(
        (t) => now - Date.parse(t.dueAt) <= this.config.overdueHours * 3600000,
      );
      if (
        !task &&
        (!this.config.proactive ||
          !this.config.initiative ||
          now - this.state.lastInteraction < this.config.idleMinutes * 60000 ||
          this.state.boredom < 100 - this.config.initiative ||
          this.state.energy < 20)
      )
        return;
      // Claim and charge the attempt before any network IO. Crash recovery never
      // replays an ambiguous in-flight action; failures consume budget too.
      this.store.update((d) => {
        const state = { ...this.state },
          day = localClock(now, this.config.timeZone).day;
        state.dailyUsed = state.day === day ? state.dailyUsed + 1 : 1;
        state.day = day;
        state.lastAction = now;
        state.boredom = Math.max(this.config.floor, state.boredom - 10);
        d.automation.states[characterId] = state;
        if (task)
          d.automation.tasks.find((t) => t.id === task.id)!.status = "running";
      });
      this.log(
        "action-start",
        task
          ? `Reminder: ${task.title} (${task.id})`
          : "Initiative: idle threshold and boredom threshold reached.",
      );
      this.changed();
      try {
        await this.deliver(task);
        if (task) this.finish(task.id, "done", "Reply saved to conversation.");
      } catch {
        if (task)
          this.finish(
            task.id,
            "failed",
            "Interrupted or provider failed; no automatic retry. See activity log.",
          );
      }
    } finally {
      this.inTick = false;
      this.changed();
    }
  }
  private finish(
    id: string,
    status: "done" | "missed" | "failed",
    outcome: string,
  ) {
    const previous = this.store.data.automation.tasks.find(
      (task) => task.id === id,
    )!;
    if (previous.status === "cancelled") return;
    this.store.update((d) => {
      const task = d.automation.tasks.find((t) => t.id === id)!;
      if (task.status !== "cancelled") {
        task.status = status;
        task.outcome = outcome;
      }
    });
    this.log(`task-${status}`, `${id}: ${outcome}`, {}, previous.characterId);
  }
}
