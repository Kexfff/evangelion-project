import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { minecraftFactory } from "../electron/minecraft-transport";
import { minecraftConfigSchema } from "../src/shared/minecraft";

const mock = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("electron", () => ({ utilityProcess: { fork: mock.fork } }));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function fixture() {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
    postMessage: vi.fn(),
  });
  child.kill.mockImplementation(() => child.emit("exit", 1));
  child.postMessage.mockImplementation((message) => {
    if (message.type === "shutdown") child.emit("exit", 0);
    if (message.type === "mcp" && message.data.method === "initialize")
      Promise.resolve().then(() =>
        child.emit("message", {
          type: "mcp",
          data: {
            jsonrpc: "2.0",
            id: message.data.id,
            result: {
              protocolVersion: message.data.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1" },
            },
          },
        }),
      );
  });
  mock.fork.mockReturnValue(child);
  const state = vi.fn(),
    invalidated = vi.fn();
  const connection = minecraftFactory("fixture.cjs")(
    minecraftConfigSchema.parse({}),
    state,
    invalidated,
  );
  await connection.connect(new AbortController().signal);
  const update = (data = { connected: true, status: "Connected" }) =>
    child.emit("message", { type: "state", data });
  return { child, state, invalidated, connection, update };
}

describe("Minecraft worker liveness", () => {
  it("interrupts a frozen worker instead of leaving its green job indefinitely", async () => {
    const f = await fixture();
    f.update();
    await vi.advanceTimersByTimeAsync(11000);
    expect(f.invalidated).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("stopped responding"),
    );
    expect(f.child.kill).toHaveBeenCalledOnce();
    await f.connection.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("accepts regular stationary updates and cleans its watchdog on normal close", async () => {
    const f = await fixture();
    for (let n = 0; n < 20; n++) {
      f.update();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(f.invalidated).not.toHaveBeenCalled();
    await f.connection.close();
    await vi.advanceTimersByTimeAsync(15000);
    expect(f.child.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not silently discard corrupt world updates while retaining old state", async () => {
    const f = await fixture();
    f.child.emit("message", {
      type: "state",
      data: {
        connected: true,
        status: "Connected",
        position: { x: NaN, y: 64, z: 0 },
      },
    });
    expect(f.state).not.toHaveBeenCalled();
    expect(f.invalidated).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("invalid world coordinates"),
    );
    await f.connection.close();
  });
});
