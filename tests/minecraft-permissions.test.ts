import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  minecraftConfigSchema,
  minecraftTools,
  MINECRAFT_ID,
  type MinecraftLive,
} from "../src/shared/minecraft";
import {
  effectiveToolPolicy,
  minecraftRuntimeConfig,
} from "../src/shared/minecraft-permissions";
import { mcpConfigSchema } from "../src/shared/mcp";
import { Store } from "../electron/store";
import { CredentialVault } from "../electron/credentials";
import { MinecraftPlugin } from "../electron/minecraft-plugin";
import { McpPlugin, compileMcpTool } from "../electron/mcp-plugin";
import { GameCoordinator } from "../electron/game-coordinator";

const dirs: string[] = [];
const active: McpPlugin[] = [];
afterEach(async () => {
  for (const p of active.splice(0)) await p.stop();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
const config = () =>
  mcpConfigSchema.parse({
    id: MINECRAFT_ID,
    name: "Minecraft",
    transport: "stdio",
    command: "bundled:minecraft",
    characterId: "eva",
  });
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "eva-mc-permissions-"));
  dirs.push(dir);
  const store = new Store(dir);
  store.update((d) => {
    d.minecraft.config = minecraftConfigSchema.parse({
      freePlay: false,
      modifyBlocks: false,
      chat: false,
      radius: 32,
      buildRadius: 4,
      jobSeconds: 30,
    });
  });
  let publish!: (s: MinecraftLive) => void;
  const transport = {
    connect: vi.fn(async () => {}),
    list: vi.fn(async () => JSON.parse(JSON.stringify(minecraftTools))),
    call: vi.fn(async () => ({
      content: [{ type: "text", text: "accepted" }],
    })),
    close: vi.fn(async () => {}),
    stopAction: vi.fn(),
    updatePermissions: vi.fn(),
  };
  const factory = vi.fn((_c, callback) => {
    publish = callback;
    return transport;
  });
  const minecraft = new MinecraftPlugin(store, () => {}, factory);
  const mcp = new McpPlugin(
    store,
    new CredentialVault(dir, null),
    () => {},
    (_c, _s, invalidated) => minecraft.create(invalidated),
  );
  active.push(mcp);
  const ctx = () => ({
    characterId: store.characterId,
    sessionId: store.sessionId,
    channel: "desktop" as const,
  });
  return {
    store,
    minecraft,
    mcp,
    factory,
    transport,
    ctx,
    publish: (s: MinecraftLive) => publish(s),
  };
}

describe("Minecraft allow-unless-blocked permissions", () => {
  it("routes coordinator steps through real MCP validation, grants and audit", async () => {
    const f = fixture();
    await f.mcp.configure(config());
    await f.mcp.action(MINECRAFT_ID, "connect");
    const live: MinecraftLive = {
      connected: true,
      status: "Connected",
      dimension: "overworld",
      inventory: [],
      players: [],
      nearby: [],
    };
    f.publish(live);
    const runtime: any = {
      store: f.store,
      busy: false,
      broadcast: () => {},
      autonomy: {
        config: { paused: false },
        log: () => {},
        gate: () => "Ready",
      },
      planGame: vi.fn(async () =>
        JSON.stringify({
          decision: "step",
          tool: "collect_blocks",
          args: { block: "stone", count: 3 },
          reason: "Gather cobblestone",
        }),
      ),
    };
    const game = new GameCoordinator(runtime, f.minecraft, f.mcp);
    f.transport.call.mockImplementation(async (...args: any[]) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            args[0] === "observe" ? live : { jobId: "gather" },
          ),
        },
      ],
    }));
    const submit = () =>
      game.submit(
        {
          objective: "Get cobblestone",
          completion: [{ kind: "inventory", item: "cobblestone", count: 3 }],
        },
        f.ctx(),
      );
    try {
      submit();
      await game.tick();
      expect(f.store.data.minecraft.goals.at(-1)).toMatchObject({
        status: "running",
        jobId: "gather",
      });
      expect(f.mcp.snapshot().audit.at(-1)).toMatchObject({
        tool: "collect_blocks",
        outcome: "succeeded",
      });
      game.cancelAll();
      const tool = f.mcp
        .snapshot()
        .servers[0].tools.find((t) => t.name === "collect_blocks")!;
      f.mcp.grant(MINECRAFT_ID, tool.name, tool.fingerprint, "deny");
      f.transport.call.mockClear();
      submit();
      await game.tick();
      expect(f.store.data.minecraft.goals.at(-1)?.status).toBe("failed");
      expect(
        f.transport.call.mock.calls.every(
          (call: unknown[]) => call[0] === "observe",
        ),
      ).toBe(true);
    } finally {
      game.stop();
    }
  });
  it.each([
    ["drop_items", { item: "stone", count: 1 }],
    ["sleep", {}],
    ["attack_entity", { entityId: 2 }],
    ["container", { action: "inspect", position: { x: 0, y: 64, z: 0 } }],
    ["dig_block", { position: { x: 0, y: 64, z: 0 } }],
  ])(
    "new tool %s is available by default and honors an explicit block",
    async (name, args) => {
      const f = fixture();
      await f.mcp.configure(config());
      await f.mcp.action(MINECRAFT_ID, "connect");
      const tool = compileMcpTool(
        JSON.parse(JSON.stringify(minecraftTools.find((t) => t.name === name))),
        MINECRAFT_ID,
      );
      expect(
        await f.mcp.execute(
          tool.alias,
          args,
          f.ctx(),
          new AbortController().signal,
        ),
      ).toHaveProperty("untrustedToolResult");
      f.mcp.grant(MINECRAFT_ID, tool.name, tool.fingerprint, "deny");
      f.transport.call.mockClear();
      expect(
        await f.mcp.execute(
          tool.alias,
          args,
          f.ctx(),
          new AbortController().signal,
        ),
      ).toHaveProperty("error");
      expect(f.transport.call).not.toHaveBeenCalled();
    },
  );
  it("exposes and executes mining without any grant or legacy modifyBlocks switch", async () => {
    const f = fixture();
    await f.mcp.configure(config());
    await f.mcp.action(MINECRAFT_ID, "connect");
    expect(
      f.mcp.snapshot().servers[0].tools.every((t) => t.policy === "allow"),
    ).toBe(true);
    expect(f.mcp.definitions()).toHaveLength(minecraftTools.length);
    expect(f.factory.mock.calls[0][0]).toMatchObject({
      modifyBlocks: true,
      freePlay: true,
      navigationBlocks: true,
      radius: 0,
      buildRadius: 0,
      jobSeconds: 0,
    });
    const tool = compileMcpTool(
      JSON.parse(
        JSON.stringify(minecraftTools.find((t) => t.name === "collect_blocks")),
      ),
      MINECRAFT_ID,
    );
    const result = await f.mcp.execute(
      tool.alias,
      { block: "stone", count: 1 },
      f.ctx(),
      new AbortController().signal,
    );
    expect(result).toHaveProperty("untrustedToolResult");
    expect(f.transport.call).toHaveBeenCalled();
    expect(f.mcp.snapshot().pending).toEqual([]);
  });
  it("honors explicit blocks, disables indirect terrain editing, and immediately restores Allow", async () => {
    const f = fixture();
    await f.mcp.configure(config());
    await f.mcp.action(MINECRAFT_ID, "connect");
    const tool = f.mcp
      .snapshot()
      .servers[0].tools.find((t) => t.name === "collect_blocks")!;
    f.mcp.grant(MINECRAFT_ID, tool.name, tool.fingerprint, "deny");
    f.minecraft.refreshPermissions();
    expect(f.transport.updatePermissions).toHaveBeenLastCalledWith(
      expect.objectContaining({ navigationBlocks: false }),
    );
    const alias = compileMcpTool(
      JSON.parse(
        JSON.stringify(minecraftTools.find((t) => t.name === tool.name)),
      ),
      MINECRAFT_ID,
    ).alias;
    expect(
      await f.mcp.execute(
        alias,
        { block: "stone", count: 1 },
        f.ctx(),
        new AbortController().signal,
      ),
    ).toHaveProperty("error");
    expect(f.transport.call).not.toHaveBeenCalled();
    f.mcp.grant(MINECRAFT_ID, tool.name, tool.fingerprint, "allow");
    f.minecraft.refreshPermissions();
    expect(f.transport.updatePermissions).toHaveBeenLastCalledWith(
      expect.objectContaining({ modifyBlocks: true, navigationBlocks: true }),
    );
  });
  it("keeps explicit blocks across description changes, connection saves and reconnects", async () => {
    const f = fixture();
    await f.mcp.configure(config());
    await f.mcp.action(MINECRAFT_ID, "connect");
    const tool = f.mcp
      .snapshot()
      .servers[0].tools.find((t) => t.name === "build_blocks")!;
    f.mcp.grant(MINECRAFT_ID, tool.name, tool.fingerprint, "deny");
    f.transport.list.mockImplementation(async () =>
      JSON.parse(
        JSON.stringify(
          minecraftTools.map((t) => ({
            ...t,
            description: t.description + " Updated.",
          })),
        ),
      ),
    );
    await f.mcp.configure(config());
    await f.mcp.action(MINECRAFT_ID, "connect");
    expect(
      f.mcp.snapshot().servers[0].tools.find((t) => t.name === tool.name)
        ?.policy,
    ).toBe("deny");
    expect(f.mcp.definitions()).toHaveLength(minecraftTools.length - 1);
  });
  it("migrates legacy limits once but preserves newly selected optional limits", () => {
    const f = fixture();
    expect(f.store.data.minecraft.permissionsVersion).toBe(1);
    expect(f.store.data.minecraft.config.jobSeconds).toBe(0);
    f.store.update((d) => {
      d.minecraft.config.jobSeconds = 120;
    });
    new MinecraftPlugin(f.store, () => {});
    expect(f.store.data.minecraft.config.jobSeconds).toBe(120);
  });
  it("does not allow unrecognized tools or change external MCP defaults", () => {
    const tool = { name: "collect_blocks", fingerprint: "a".repeat(64) };
    expect(
      effectiveToolPolicy(
        { ...config(), command: "some-other-program" },
        [],
        tool,
      ),
    ).toBe("deny");
    expect(effectiveToolPolicy({ ...config(), id: "external" }, [], tool)).toBe(
      "deny",
    );
    expect(
      effectiveToolPolicy(config(), [], { ...tool, name: "execute_code" }),
    ).toBe("deny");
    expect(
      effectiveToolPolicy(
        config(),
        [{ tool: tool.name, fingerprint: "b".repeat(64), policy: "deny" }],
        tool,
      ),
    ).toBe("deny");
  });
  it("does not bypass Ask with automatic navigation", () => {
    const cfg = minecraftRuntimeConfig(minecraftConfigSchema.parse({}), [
      { tool: "collect_blocks", fingerprint: "a".repeat(64), policy: "ask" },
    ]);
    expect(cfg.modifyBlocks).toBe(true); // available after per-call approval
    expect(cfg.navigationBlocks).toBe(false);
  });
  it("keeps background state internal and instructs natural, quiet responses", async () => {
    const f = fixture();
    await f.mcp.configure(config());
    await f.mcp.action(MINECRAFT_ID, "connect");
    f.publish({
      connected: true,
      status: "Connected",
      dimension: "overworld",
      players: [],
      nearby: [],
      inventory: [],
    });
    expect(f.minecraft.context()).toContain(
      "Do not narrate tool calls, job IDs",
    );
    expect(f.minecraft.context()).toContain("unrelated conversation");
    expect(f.minecraft.context()).toContain("Sequence dependent actions");
    expect(f.minecraft.context()).toContain(
      "check job_status for completion/result",
    );
    expect(f.minecraft.context()).toContain(
      "Never claim an action finished without verified results",
    );
  });
});
