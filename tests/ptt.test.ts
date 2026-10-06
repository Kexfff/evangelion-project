import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PttEdges,
  pttConfigSchema,
  pttLabel,
  pttPortalTrigger,
} from "../src/shared/ptt";
import { PttService, type BindShortcut } from "../electron/ptt-service";
import { defaultSettings, settingsSchema } from "../src/shared/schema";

afterEach(() => vi.useRealTimers());
describe("press-to-talk edges and migration", () => {
  it("defaults existing profiles to off without reserving a key", () => {
    const raw = structuredClone(defaultSettings) as any;
    delete raw.voice.ptt;
    expect(settingsSchema.parse(raw).voice.ptt).toMatchObject({
      enabled: false,
      key: "ShiftRight",
      mode: "hold",
      scope: "app",
    });
    expect(pttConfigSchema.safeParse({ enabled: true, key: "" }).success).toBe(
      false,
    );
    expect(pttConfigSchema.safeParse({ key: "Enter;exec" }).success).toBe(
      false,
    );
    const c = pttConfigSchema.parse({ key: "V", ctrl: true, shift: true });
    expect(pttLabel(c)).toBe("Ctrl+Shift+V");
    expect(pttPortalTrigger(c)).toBe("CTRL+SHIFT+v");
  });
  it("holds once despite auto-repeat and finishes once on release", () => {
    const emit = vi.fn();
    const e = new PttEdges("hold", emit);
    e.release();
    e.press();
    e.press();
    e.press();
    e.release();
    e.release();
    expect(emit.mock.calls.flat()).toEqual(["start", "finish"]);
  });
  it("toggle requires a release before another press, and cancellation never sends", () => {
    const emit = vi.fn();
    const e = new PttEdges("toggle", emit);
    e.press();
    e.press();
    e.release();
    e.press();
    e.release();
    e.press();
    e.cancel();
    e.release();
    expect(emit.mock.calls.flat()).toEqual([
      "start",
      "finish",
      "start",
      "cancel",
    ]);
  });
  it("a rejected/completed capture resets toggle without retriggering a held key", () => {
    const emit = vi.fn();
    const e = new PttEdges("toggle", emit);
    e.press();
    e.settled();
    e.press();
    e.release();
    e.press();
    expect(emit.mock.calls.flat()).toEqual(["start", "start"]);
  });
});
describe("shortcut service", () => {
  const c = pttConfigSchema.parse({
    enabled: true,
    key: "F8",
    scope: "global",
  });
  it("reports real registration state, filters repeats, and cleans up on rebind", async () => {
    let edge!: (d: boolean) => void;
    const close = vi.fn(),
      emit = vi.fn();
    const bind: BindShortcut = async (_c, e, changed) => {
      edge = e;
      changed("F9 (desktop assigned)");
      return { close };
    };
    const service = new PttService(bind, emit, vi.fn());
    await service.configure(c);
    expect(service.status).toMatchObject({
      state: "ready",
      binding: "F9 (desktop assigned)",
    });
    emit.mockClear();
    edge(true);
    edge(true);
    edge(false);
    expect(emit.mock.calls.flat()).toEqual(["start", "finish"]);
    await service.configure({ ...c, scope: "app" });
    expect(close).toHaveBeenCalledOnce();
    emit.mockClear();
    edge(true);
    expect(emit).not.toHaveBeenCalled();
    service.close();
  });
  it("does not silently fall back to toggle/app when a global binding fails", async () => {
    const service = new PttService(
      async () => {
        throw new Error("Not supported");
      },
      vi.fn(),
      vi.fn(),
    );
    await service.configure(c);
    expect(service.status).toMatchObject({
      state: "unavailable",
      message: "Not supported",
    });
    service.close();
  });
  it("discards late registration after disabling", async () => {
    let finish!: (v: { close(): void }) => void;
    const close = vi.fn();
    const service = new PttService(
      () =>
        new Promise((r) => {
          finish = r;
        }),
      vi.fn(),
      vi.fn(),
    );
    const first = service.configure(c);
    await service.configure({ ...c, enabled: false });
    finish({ close });
    await first;
    expect(close).toHaveBeenCalledOnce();
    expect(service.status.state).toBe("off");
    service.close();
  });
  it("tests edges without microphone actions, exits after 30 seconds", async () => {
    vi.useFakeTimers();
    let edge!: (d: boolean) => void;
    const emit = vi.fn();
    const service = new PttService(
      async (_c, e) => {
        edge = e;
        return { close() {} };
      },
      emit,
      vi.fn(),
    );
    await service.configure(c);
    service.test(true);
    emit.mockClear();
    edge(true);
    edge(false);
    expect(emit).not.toHaveBeenCalled();
    expect(service.status.lastEdge).toBe("released");
    await vi.advanceTimersByTimeAsync(30000);
    expect(service.status.testing).toBe(false);
    service.close();
  });
  it("cancels on revocation/suspend and requires a fresh press on resume", async () => {
    let changed!: (v: string | null) => void;
    const close = vi.fn(),
      emit = vi.fn();
    const service = new PttService(
      async (_c, _e, change) => {
        changed = change;
        return { close };
      },
      emit,
      vi.fn(),
    );
    await service.configure(c);
    emit.mockClear();
    changed(null);
    expect(emit).toHaveBeenCalledWith("cancel");
    expect(service.status.state).toBe("unavailable");
    service.suspend(true);
    expect(service.status.state).toBe("suspended");
    expect(close).toHaveBeenCalledOnce();
    service.suspend(false);
    await Promise.resolve();
    expect(service.status.state).toBe("ready");
    service.close();
  });
});
