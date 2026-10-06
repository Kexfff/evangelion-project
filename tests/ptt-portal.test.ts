import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ bus: null as any }));
vi.mock("dbus-next", () => ({
  default: {
    sessionBus: () => state.bus,
    MessageType: { SIGNAL: 4 },
    Message: class {
      constructor(value: object) {
        Object.assign(this, value);
      }
    },
    Variant: class {
      constructor(
        public signature: string,
        public value: unknown,
      ) {}
    },
  },
}));
import { bindPortalShortcut } from "../electron/ptt-portal";
import { pttConfigSchema } from "../src/shared/ptt";
const path = "/org/freedesktop/portal/desktop",
  iface = "org.freedesktop.portal.GlobalShortcuts";
const session = `${path}/session/1_99/eva_fixture`;
const config = pttConfigSchema.parse({ enabled: true, scope: "global" });
let code: number, missing: boolean, stall: boolean;
beforeEach(() => {
  code = 0;
  missing = false;
  stall = false;
  const bus = (state.bus = new EventEmitter() as any);
  bus.name = ":1.99";
  bus.disconnect = vi.fn();
  bus.send = vi.fn();
  bus.call = vi.fn(async (m: any) => {
    if (m.member === "GetNameOwner") return { body: [":1.80"] };
    if (["Register", "AddMatch"].includes(m.member)) return { body: [] };
    const request = `${path}/request/1_99/${m.body.at(-1).handle_token.value}`;
    if (stall) return { body: [request] };
    // Emit before returning the method result, reproducing the portal response race.
    bus.emit("message", {
      type: 4,
      sender: ":1.80",
      path: request,
      interface: "org.freedesktop.portal.Request",
      member: "Response",
      body: [
        code,
        m.member === "CreateSession"
          ? { session_handle: { value: session } }
          : {
              shortcuts: {
                value: missing
                  ? []
                  : [
                      [
                        "press_to_talk",
                        { trigger_description: { value: "Right Shift" } },
                      ],
                    ],
              },
            },
      ],
    });
    return { body: [request] };
  });
});
afterEach(() => vi.useRealTimers());
const signal = (member: string, body: unknown[], extra: object = {}) =>
  state.bus.emit("message", {
    type: 4,
    sender: ":1.80",
    path,
    interface: iface,
    member,
    body,
    ...extra,
  });

it("handles early Response, binds Shift_R, and filters signals to its session and sender", async () => {
  const edge = vi.fn(),
    changed = vi.fn();
  const binding = await bindPortalShortcut(
    config,
    edge,
    changed,
    new AbortController().signal,
  );
  const bind = state.bus.call.mock.calls.find(
    ([m]: any) => m.member === "BindShortcuts",
  )[0];
  expect(bind.body[1][0][1].preferred_trigger.value).toBe("Shift_R");
  expect(changed).toHaveBeenCalledWith("Right Shift");
  signal("Activated", ["/wrong", "press_to_talk"]);
  signal("Activated", [session, "other"]);
  signal("Activated", [session, "press_to_talk"], { sender: ":1.81" });
  expect(edge).not.toHaveBeenCalled();
  signal("Activated", [session, "press_to_talk"]);
  signal("Deactivated", [session, "press_to_talk"]);
  expect(edge.mock.calls.flat()).toEqual([true, false]);
  binding.close();
  binding.close();
  expect(state.bus.disconnect).toHaveBeenCalledOnce();
  signal("Activated", [session, "press_to_talk"]);
  expect(edge).toHaveBeenCalledTimes(2);
});
it.each([1, 2])(
  "reports refused session response %s, not a false registered status",
  async (response) => {
    code = response;
    await expect(
      bindPortalShortcut(
        config,
        vi.fn(),
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toThrow(
      response === 1 ? "permission cancelled" : "cannot create",
    );
    expect(state.bus.disconnect).toHaveBeenCalledOnce();
  },
);
it("requires a returned assigned shortcut and cleans up a refused binding", async () => {
  missing = true;
  await expect(
    bindPortalShortcut(config, vi.fn(), vi.fn(), new AbortController().signal),
  ).rejects.toThrow("No shortcut was assigned");
  expect(state.bus.disconnect).toHaveBeenCalledOnce();
});
it("aborts pending desktop consent without waiting for a Response", async () => {
  stall = true;
  const controller = new AbortController();
  const result = bindPortalShortcut(
    config,
    vi.fn(),
    vi.fn(),
    controller.signal,
  );
  const rejected = expect(result).rejects.toThrow("cancelled");
  await vi.waitFor(() =>
    expect(
      state.bus.call.mock.calls.some(
        ([m]: any) => m.member === "CreateSession",
      ),
    ).toBe(true),
  );
  controller.abort();
  await rejected;
  expect(state.bus.disconnect).toHaveBeenCalledOnce();
});
it("portal termination revokes the shortcut and disconnects", async () => {
  const changed = vi.fn();
  await bindPortalShortcut(
    config,
    vi.fn(),
    changed,
    new AbortController().signal,
  );
  signal("NameOwnerChanged", ["org.freedesktop.portal.Desktop", ":1.80", ""], {
    sender: "org.freedesktop.DBus",
    interface: "org.freedesktop.DBus",
  });
  expect(changed).toHaveBeenLastCalledWith(null);
  expect(state.bus.disconnect).toHaveBeenCalledOnce();
});
