// Opt-in acceptance against a real provider and world, using a disposable Store.
// The engine bridge exercises the production MCP policy/coordinator, not IPC.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Store } from "../../electron/store";
import { CredentialVault } from "../../electron/credentials";
import { CompanionRuntime } from "../../electron/runtime";
import { MinecraftPlugin } from "../../electron/minecraft-plugin";
import { McpPlugin } from "../../electron/mcp-plugin";
import { GameCoordinator } from "../../electron/game-coordinator";
import type { MinecraftEngine } from "../../electron/minecraft-engine";
import { minecraftTools, MINECRAFT_ID } from "../../src/shared/minecraft";

export async function acceptAutonomy(engine: MinecraftEngine) {
  assert.equal(
    process.env.EVA_MC_PAID_REQUESTS,
    "10",
    "Separate consent for up to ten LLM requests required",
  );
  const source = process.env.EVA_MC_PROVIDER_PROFILE;
  assert.ok(
    source && path.isAbsolute(source),
    "Explicit read-only provider profile required",
  );
  const original = await readFile(path.join(source, "companion.json"));
  const digest = (data: Buffer) =>
    createHash("sha256").update(data).digest("hex");
  const saved = JSON.parse(original.toString());
  const encrypted = JSON.parse(
    await readFile(path.join(source, "credentials.json"), "utf8"),
  );
  assert.equal(
    encrypted.entries?.llm?.mode,
    "local",
    "This Node runner supports local encrypted credentials only; use desktop acceptance for OS-keyring credentials",
  );
  const profile = await mkdtemp(path.join(tmpdir(), "eva-game-autonomy-"));
  let game: GameCoordinator | undefined;
  let mcp: McpPlugin | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let requests = 0;
  try {
    // Copy only the encrypted LLM entry, not personal memory, Telegram or MCP secrets.
    await writeFile(
      path.join(profile, "credentials.json"),
      JSON.stringify({ version: 2, entries: { llm: encrypted.entries.llm } }),
      { mode: 0o600 },
    );
    await copyFile(
      path.join(source, "credentials.key"),
      path.join(profile, "credentials.key"),
    );
    const store = new Store(profile);
    store.update((d) => {
      d.settings.providers.llm = saved.settings.providers.llm;
      d.settings.autonomy.enabled = false;
      d.settings.memory.autoRemember = false;
      d.settings.voice.autoSpeak = false;
      d.minecraft.permissionsVersion = 1;
    });
    const vault = new CredentialVault(profile, null);
    const runtime = new CompanionRuntime(
      store,
      (kind) => (kind === "llm" ? vault.get("llm") : ""),
      vault.mode,
      () => {},
    );
    const chat = runtime.provider.chat.bind(runtime.provider);
    runtime.provider.chat = async (...args) => {
      assert.ok(
        requests < 10,
        "Hard test cap: no more than ten provider requests",
      );
      requests++;
      console.log("AUTONOMY_REQUEST", requests);
      return chat(...args);
    };
    const minecraft = new MinecraftPlugin(
      store,
      () => {},
      (_config, publish) => ({
        async connect() {
          publish(engine.observe());
          heartbeat = setInterval(() => publish(engine.observe()), 200);
        },
        async list() {
          return JSON.parse(JSON.stringify(minecraftTools));
        },
        async call(name, args, signal) {
          signal.throwIfAborted();
          const result = await engine.call(name, args);
          publish(engine.observe());
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        },
        async close() {
          clearInterval(heartbeat);
          engine.stop();
        },
        stopAction() {
          engine.stop();
          publish(engine.observe());
        },
      }),
    );
    mcp = new McpPlugin(
      store,
      vault,
      () => {},
      (_config, _secrets, invalidated) => minecraft.create(invalidated),
    );
    await minecraft.configure(
      {
        ...engine.config,
        characterId: store.characterId,
        worldId: "disposable-acceptance-arena",
      },
      mcp,
    );
    await mcp.action(MINECRAFT_ID, "connect");
    game = new GameCoordinator(runtime, minecraft, mcp);
    const inventory = engine.observe().inventory;
    const targets = ["stone_axe", "stone_shovel", "stone_hoe"].map(
      (item) =>
        `${item}: ${inventory.filter((i) => i.name === item).reduce((n, i) => n + i.count, 0) + 1} total`,
    );
    game.configureAutonomy({
      enabled: true,
      preference: "objective",
      intervalSeconds: 10,
      hourlyRequests: 10,
      sessionRequests: 10,
      objective: `In this disposable test arena, make these three inventory stock milestones, ONE separate intention at a time, in order: ${targets.join("; ")}. Use existing ingredients and crafting tables. Do not dig, build or leave the arena. Then rest.`,
    });
    const until = Date.now() + 240000;
    let previous = "";
    while (Date.now() < until) {
      await game.tick();
      const goals = store.data.minecraft.goals;
      const state = JSON.stringify({
        requests,
        detail: game.director.state.detail,
        goals: goals.map((g) => ({
          objective: g.objective,
          status: g.status,
          detail: g.detail,
        })),
      });
      if (state !== previous) {
        console.log("AUTONOMY", state);
        previous = state;
      }
      if (goals.filter((g) => g.status === "completed").length >= 3) break;
      if (requests >= 10 && !goals.some((g) => g.status === "running")) break;
      await delay(500);
    }
    const completed = store.data.minecraft.goals.filter(
      (g) => g.status === "completed",
    ).length;
    game.cancelAll();
    const atStop = requests;
    for (let i = 0; i < 22; i++) {
      await delay(500);
      await game.tick();
    }
    assert.equal(
      requests,
      atStop,
      "Stop must prevent further autonomous planning",
    );
    assert.equal(store.data.settings.autonomy.enabled, false);
    assert.ok(
      completed >= 3,
      `Only ${completed}/3 intentions completed in ${requests} requests`,
    );
    console.log(
      "PASS: three real-provider intentions with Consciousness off; Stop stays stopped",
      JSON.stringify(game.director.state.session),
    );
  } finally {
    game?.stop();
    clearInterval(heartbeat);
    await mcp?.stop();
    // Compare without printing settings, credentials or their hashes.
    try {
      assert.equal(
        digest(await readFile(path.join(source, "companion.json"))),
        digest(original),
        "Normal profile changed during acceptance",
      );
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
}
