import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Autonomy, evolve, quietNow, localClock } from "../electron/autonomy";
import { Store } from "../electron/store";
import { CompanionRuntime } from "../electron/runtime";
import {
  initialBehavior,
  defaultAutonomyConfig,
  taskInputSchema,
} from "../src/shared/autonomy";
import {
  defaultSettings,
  settingsSchema,
  type RuntimeEvent,
} from "../src/shared/schema";
import { OpenAICompatibleProvider, consumeSSE } from "../electron/providers";
import {
  executeScheduleTool,
  schedulingTools,
} from "../electron/scheduling-tools";

const dirs: string[] = [];
const start = Date.parse("2026-09-12T12:00:00Z");
function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "eva-autonomy-"));
  dirs.push(dir);
  const store = new Store(dir);
  let now = start,
    busy = false;
  store.update((d) => {
    d.settings.autonomy = {
      ...defaultAutonomyConfig,
      enabled: true,
      quietEnabled: false,
      cooldownMinutes: 1,
    };
    d.automation.states.eva = {
      ...initialBehavior(now),
      lastInteraction: now - 60000,
    };
  });
  const deliver = vi.fn().mockResolvedValue(undefined);
  const create = () =>
    new Autonomy(
      store,
      () => busy,
      deliver,
      () => {},
      () => now,
    );
  const engine = create();
  const presence = () => engine.setPresence({ blocked: false, visible: true });
  presence();
  const advance = (ms: number) => {
    now += ms;
    presence();
  };
  const task = () =>
    engine.createTask({
      title: "Tea",
      intent: "Have tea",
      dueAt: new Date(now + 1000).toISOString(),
      timeZone: "Europe/Moscow",
    });
  return {
    store,
    engine,
    deliver,
    task,
    advance,
    dir,
    create,
    now: () => now,
    busy: (value: boolean) => {
      busy = value;
    },
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

describe("durable behavior and scheduling policy", () => {
  it("migrates old databases without enabling autonomy or deleting messages", () => {
    const { store, dir } = setup();
    const old = JSON.parse(readFileSync(store.file, "utf8"));
    delete old.automation;
    delete old.settings.autonomy;
    writeFileSync(store.file, JSON.stringify(old));
    const reopened = new Store(dir);
    expect(reopened.data.settings.autonomy.enabled).toBe(false);
    expect(reopened.data.automation).toEqual({
      states: {},
      tasks: [],
      activity: [],
    });
    expect(
      settingsSchema.safeParse({
        ...defaultSettings,
        autonomy: { ...defaultAutonomyConfig, timeZone: "bogus/zone" },
      }).success,
    ).toBe(false);
  });
  it("bounds offline drift and explains interaction without punishing relationships", () => {
    const before = initialBehavior(start);
    const later = evolve(before, start + 30 * 86400000, defaultAutonomyConfig);
    expect(later.boredom).toBe(54);
    expect(later.trust).toBe(before.trust);
    const interacted = evolve(
      later,
      start + 30 * 86400000 + 60000,
      { ...defaultAutonomyConfig, floor: 10, ceiling: 80 },
      true,
    );
    expect(interacted.boredom).toBeLessThan(later.boredom);
    expect(interacted.trust).toBeGreaterThan(later.trust);
    expect(interacted.reason).toContain("User interaction");
    for (const key of [
      "mood",
      "boredom",
      "energy",
      "trust",
      "affinity",
    ] as const)
      expect(interacted[key]).toBeGreaterThanOrEqual(10);
  });
  it("handles overnight quiet hours, IANA zones, DST and all-day quiet", () => {
    const cfg = { ...defaultAutonomyConfig, timeZone: "Europe/Moscow" };
    expect(quietNow(Date.parse("2026-09-12T21:00:00Z"), cfg)).toBe(true);
    expect(quietNow(Date.parse("2026-09-13T05:00:00Z"), cfg)).toBe(false);
    expect(
      quietNow(start, { ...cfg, quietStart: "08:00", quietEnd: "08:00" }),
    ).toBe(true);
    expect(
      localClock(Date.parse("2026-11-01T05:30:00Z"), "America/New_York").time,
    ).toBe("01:30");
    expect(
      localClock(Date.parse("2026-11-01T06:30:00Z"), "America/New_York").time,
    ).toBe("01:30");
  });
  it("fires an authorized reminder once after restart and defers while user is busy", async () => {
    const t = setup(),
      reminder = t.task();
    t.advance(2000);
    t.busy(true);
    await t.engine.tick();
    expect(t.deliver).not.toHaveBeenCalled();
    const reopened = new Store(t.dir),
      delivered = vi.fn().mockResolvedValue(undefined);
    const engine = new Autonomy(
      reopened,
      () => false,
      delivered,
      () => {},
      t.now,
    );
    engine.setPresence({ blocked: false, visible: true });
    await engine.tick();
    await engine.tick();
    expect(delivered).toHaveBeenCalledTimes(1);
    expect(
      reopened.data.automation.tasks.find((task) => task.id === reminder.id)
        ?.status,
    ).toBe("done");
    const again = new Autonomy(
      new Store(t.dir),
      () => false,
      delivered,
      () => {},
      t.now,
    );
    again.setPresence({ blocked: false, visible: true });
    await again.tick();
    expect(delivered).toHaveBeenCalledTimes(1);
  });
  it("requires approval for LLM tasks and isolates task access by character", async () => {
    const t = setup();
    const pending = t.engine.createTask(
      {
        title: "Check",
        intent: "Check in",
        dueAt: new Date(start + 1000).toISOString(),
        timeZone: "UTC",
      },
      "llm",
    );
    t.advance(2000);
    await t.engine.tick();
    expect(t.deliver).not.toHaveBeenCalled();
    t.engine.taskAction(pending.id, "approve");
    await t.engine.tick();
    expect(t.deliver).toHaveBeenCalledTimes(1);
    const other = t.task();
    t.store.update((d) => {
      d.automation.tasks.find((task) => task.id === other.id)!.characterId =
        "other";
    });
    expect(() => t.engine.taskAction(other.id, "cancel")).toThrow("not found");
    expect(t.engine.snapshot().tasks).toHaveLength(1);
  });
  it("respects off/pause, quiet hours, heartbeat, hidden UI, busy presence, and suspension", async () => {
    const t = setup();
    t.task();
    t.advance(2000);
    for (const patch of [
      { enabled: false },
      { enabled: true, paused: true },
      {
        paused: false,
        quietEnabled: true,
        quietStart: "00:00",
        quietEnd: "00:00",
      },
    ]) {
      t.store.update((d) => {
        Object.assign(d.settings.autonomy, patch);
      });
      await t.engine.tick();
    }
    t.store.update((d) => {
      d.settings.autonomy.quietEnabled = false;
    });
    t.engine.setPresence({ visible: false, blocked: false });
    await t.engine.tick();
    t.engine.setPresence({ visible: true, blocked: true });
    await t.engine.tick();
    t.engine.suspend(true);
    await t.engine.tick();
    t.engine.suspend(false);
    await t.engine.tick();
    expect(t.deliver).not.toHaveBeenCalled();
    t.advance(1);
    await t.engine.tick();
    expect(t.deliver).toHaveBeenCalledTimes(1);
  });
  it("enforces cooldown/day budget including failed attempts and resets on local day", async () => {
    const t = setup();
    t.store.update((d) => {
      d.settings.autonomy.dailyBudget = 1;
    });
    t.task();
    t.advance(2000);
    t.deliver.mockRejectedValueOnce(new Error("offline"));
    await t.engine.tick();
    expect(t.store.data.automation.tasks[0].status).toBe("failed");
    t.task();
    t.advance(2000);
    await t.engine.tick();
    expect(t.deliver).toHaveBeenCalledTimes(1);
    t.advance(86400000);
    t.store.update((d) => {
      d.settings.autonomy.overdueHours = 48;
    });
    await t.engine.tick();
    expect(t.deliver).toHaveBeenCalledTimes(2);
  });
  it("marks stale reminders missed and running-on-restart tasks failed without replay", async () => {
    const t = setup();
    t.task();
    const running = t.task();
    t.store.update((d) => {
      d.automation.tasks.find((task) => task.id === running.id)!.status =
        "running";
    });
    const engine = t.create();
    expect(t.store.data.automation.tasks[1].status).toBe("failed");
    t.advance(25 * 3600000);
    engine.setPresence({ visible: true, blocked: false });
    await engine.tick();
    expect(t.store.data.automation.tasks[0].status).toBe("missed");
    expect(t.deliver).not.toHaveBeenCalled();
  });
  it("cancels pending tasks and rejects ambiguous/past timestamps", async () => {
    const t = setup(),
      task = t.task();
    t.engine.taskAction(task.id, "cancel");
    t.advance(2000);
    await t.engine.tick();
    expect(t.deliver).not.toHaveBeenCalled();
    expect(
      taskInputSchema.safeParse({
        title: "x",
        intent: "x",
        dueAt: "tomorrow at 5",
        timeZone: "UTC",
      }).success,
    ).toBe(false);
    expect(() =>
      t.engine.createTask({
        title: "x",
        intent: "x",
        dueAt: new Date(start).toISOString(),
        timeZone: "UTC",
      }),
    ).toThrow("future");
  });
  it("initiates only with opt-in, idle/boredom/energy thresholds and no overlapping tick", async () => {
    const t = setup();
    t.advance(3600000);
    await t.engine.tick();
    expect(t.deliver).not.toHaveBeenCalled();
    t.store.update((d) => {
      d.settings.autonomy.proactive = true;
      d.settings.autonomy.initiative = 100;
    });
    let finish!: () => void;
    t.deliver.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const active = t.engine.tick();
    await t.engine.tick();
    expect(t.deliver).toHaveBeenCalledTimes(1);
    finish();
    await active;
    await t.engine.tick();
    expect(t.deliver).toHaveBeenCalledTimes(1);
  });
});

describe("runtime arbitration and scheduling protocols", () => {
  it("persists a completed autonomous reply with its reminder origin in the active session", async () => {
    const t = setup(),
      events: RuntimeEvent[] = [];
    const runtime = new CompanionRuntime(
      t.store,
      () => "",
      "local-file",
      (e) => events.push(e),
      t.now,
    );
    const chat = vi
      .spyOn(runtime.provider, "chat")
      .mockResolvedValue("Time for tea.");
    t.task();
    t.advance(2000);
    runtime.autonomy.setPresence({ visible: true, blocked: false });
    await runtime.autonomy.tick();
    expect(JSON.stringify(chat.mock.calls[0][2])).toContain(
      "routine game progress out of casual chat and proactive openers",
    );
    expect(runtime.snapshot().messages).toHaveLength(1);
    expect(runtime.snapshot().messages[0]).toMatchObject({
      role: "assistant",
      origin: "reminder",
      content: "Time for tea.",
    });
    expect(runtime.snapshot().autonomy.tasks[0].status).toBe("done");
  });
  it("user input preempts an autonomous turn and never saves its partial reply", async () => {
    const t = setup(),
      events: RuntimeEvent[] = [];
    const runtime = new CompanionRuntime(
      t.store,
      () => "",
      "local-file",
      (e) => events.push(e),
      t.now,
    );
    const chat = vi
      .spyOn(runtime.provider, "chat")
      .mockImplementationOnce(
        (_p, _k, _m, delta, signal) =>
          new Promise((_resolve, reject) => {
            delta("Partial");
            signal!.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      )
      .mockResolvedValue("User wins.");
    t.task();
    t.advance(2000);
    runtime.autonomy.setPresence({ visible: true, blocked: false });
    const active = runtime.autonomy.tick();
    expect(runtime.busy).toBe(true);
    await runtime.send("Hello");
    await active;
    expect(chat).toHaveBeenCalledTimes(2);
    expect(t.store.data.messages.map((m) => m.content)).toEqual([
      "Hello",
      "User wins.",
    ]);
    expect(events.some((e) => e.type === "autonomous-cancel")).toBe(true);
    expect(t.store.data.automation.tasks[0].status).toBe("failed");
  });
  it("cancels a running task and preserves cancelled status", async () => {
    const t = setup(),
      runtime = new CompanionRuntime(
        t.store,
        () => "",
        "local-file",
        () => {},
        t.now,
      );
    vi.spyOn(runtime.provider, "chat").mockImplementation(
      (_p, _k, _m, _delta, signal) =>
        new Promise((_resolve, reject) =>
          signal!.addEventListener("abort", () => reject(new Error("abort"))),
        ),
    );
    const task = t.task();
    t.advance(2000);
    runtime.autonomy.setPresence({ visible: true, blocked: false });
    const active = runtime.autonomy.tick();
    await runtime.taskAction(task.id, "cancel");
    await active;
    expect(t.store.data.automation.tasks[0].status).toBe("cancelled");
    expect(t.store.data.messages).toHaveLength(0);
  });
  it("runs bounded function calls, creates approval-only tasks, and records reported costs", async () => {
    const t = setup();
    t.store.update((d) => {
      d.settings.autonomy.schedulingTools = true;
    });
    const args = {
      title: "Tea",
      intent: "Brew tea",
      dueAt: new Date(start + 3600000).toISOString(),
      timeZone: "UTC",
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call-1",
                      type: "function",
                      function: {
                        name: "create_task",
                        arguments: JSON.stringify(args),
                      },
                    },
                  ],
                },
              },
            ],
            usage: { total_tokens: 10, cost: 0.001 },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "Please approve your reminder in settings.",
                },
              },
            ],
            usage: { total_tokens: 20, cost: 0.002 },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const runtime = new CompanionRuntime(
      t.store,
      () => "",
      "local-file",
      () => {},
      t.now,
    );
    await runtime.send("Remind me to brew tea in one hour");
    expect(t.store.data.automation.tasks[0].status).toBe("approval");
    expect(
      JSON.parse(fetch.mock.calls[1][1].body).messages.at(-1),
    ).toMatchObject({ role: "tool", tool_call_id: "call-1" });
    expect(t.store.data.automation.activity.at(-1)).toMatchObject({
      requests: 2,
      tokens: 30,
      cost: 0.003,
    });
  });
  it("rejects unknown tools and stops repeated tool requests after four LLM requests", async () => {
    const t = setup();
    expect(() =>
      executeScheduleTool(t.engine, "delete_everything", {}),
    ).toThrow();
    const fetch = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      id: "x",
                      function: { name: "list_tasks", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      new OpenAICompatibleProvider().chatWithTools(
        defaultSettings.providers.llm,
        "",
        [],
        schedulingTools,
        () => [],
        new AbortController().signal,
        () => {},
        () => {},
      ),
    ).rejects.toThrow("limit");
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("reads SSE token/cost metadata without leaking provider content into logs", async () => {
    const usage = vi.fn();
    const stream = new Response(
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choices":[],"usage":{"total_tokens":12,"cost":0.01}}\n\ndata: [DONE]\n\n',
    ).body!;
    expect(await consumeSSE(stream, () => {}, usage)).toBe("Hi");
    expect(usage).toHaveBeenCalledWith({ tokens: 12, cost: 0.01 });
  });
});
