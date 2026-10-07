import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { assertSmokeProfile } from "./assert-smoke-profile.mjs";

// Explicit opt-in only. Never included in npm test; joins a real user-authorized world.
if (process.env.EVA_MINECRAFT_LIVE !== "yes")
  throw new Error(
    "Set EVA_MINECRAFT_LIVE=yes only with permission to join and move in the configured world.",
  );
const profile = await mkdtemp(path.join(tmpdir(), "eva-minecraft-smoke-"));
let lookupResult;
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const data = JSON.parse(Buffer.concat(chunks).toString());
  const result = data.messages.findLast((m) => m.role === "tool");
  const text = data.messages.findLast((m) => m.role === "user")?.content;
  if (text === "Locate test" && result)
    lookupResult = JSON.parse(
      JSON.parse(result.content).untrustedToolResult.content[0].text,
    );
  const name =
    text === "Follow test"
      ? "follow_player"
      : text === "Observe test"
        ? "observe"
        : text === "Locate test"
          ? "locate_player"
          : undefined;
  const tool =
    name &&
    data.tools?.find((t) => t.function.description.includes(` / ${name}.`));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [
        {
          message:
            tool && !result
              ? {
                  tool_calls: [
                    {
                      id: "minecraft-test",
                      type: "function",
                      function: {
                        name: tool.function.name,
                        arguments:
                          name === "locate_player"
                            ? JSON.stringify({
                                player: process.env.EVA_MC_PLAYER,
                              })
                            : "{}",
                      },
                    },
                  ],
                }
              : { content: "Fixture chat remains responsive." },
        },
      ],
    }),
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let app;
try {
  app = await electron.launch({
    ...(process.env.EVA_TEST_EXECUTABLE
      ? { executablePath: process.env.EVA_TEST_EXECUTABLE }
      : {}),
    args: [
      ...(process.env.EVA_TEST_EXECUTABLE ? [] : ["."]),
      "--enable-unsafe-swiftshader",
      "--password-store=basic",
    ],
    env: { ...process.env, EVA_DEV_URL: "", EVA_TEST_DATA_DIR: profile },
  });
  await assertSmokeProfile(app, profile);
  app.process().stderr.on("data", (data) => process.stderr.write(data));
  await app.firstWindow();
  await expect
    .poll(() => app.windows().some((w) => w.url().includes("window=companion")))
    .toBe(true);
  const win = app.windows().find((w) => w.url().includes("window=companion"));
  await win.waitForFunction(() => !!window.eva);
  await win
    .locator('.avatar-renderer[data-animation="idle_loop"]')
    .waitFor({ timeout: 60000 });
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  });
  await win.evaluate(
    async ({ port, player, llmPort, lookup }) => {
      const s = await window.eva.snapshot();
      s.settings.providers.llm.baseUrl = `http://127.0.0.1:${llmPort}/v1`;
      s.settings.memory.autoRemember = false;
      s.settings.voice.autoSpeak = false;
      await window.eva.saveSettings(s.settings, {});
      await window.eva.configureMinecraft({
        ...s.minecraft.config,
        port,
        movement: true,
        freePlay: false,
        operatorLookup: lookup,
        modifyBlocks: false,
        chat: false,
        trustedPlayer: player,
        jobSeconds: 0,
        radius: 0,
      });
      await window.eva.minecraftAction("connect");
    },
    {
      port: Number(process.env.EVA_MC_PORT || 25556),
      player: process.env.EVA_MC_PLAYER || "",
      llmPort: server.address().port,
      lookup: process.env.EVA_MC_LOOKUP === "yes",
    },
  );
  await expect
    .poll(
      async () =>
        (await win.evaluate(() => window.eva.snapshot())).minecraft.live,
      { timeout: 30000 },
    )
    .toMatchObject({ connected: true });
  let snapshot = await win.evaluate(() => window.eva.snapshot());
  console.log(
    "Minecraft joined:",
    JSON.stringify({
      position: snapshot.minecraft.live.position,
      version: snapshot.minecraft.config.version,
      players: snapshot.minecraft.live.players,
      nearby: snapshot.minecraft.live.nearby,
    }),
  );
  await win.evaluate(async () => {
    const s = await window.eva.snapshot();
    const server = s.mcp.servers.find(
      (s) => s.config.id === "builtin-minecraft",
    );
    // Minecraft is now allow-by-default. Explicitly block edits/chat BEFORE
    // requesting any movement, including pathfinder's terrain modifications.
    for (const tool of server.tools.filter(
      (t) =>
        ![
          "observe",
          "inspect_inventory",
          "find_blocks",
          "get_recipes",
          "locate_player",
          "move_to",
          "follow_player",
          "job_status",
          "stop_action",
        ].includes(t.name),
    ))
      await window.eva.mcpGrant(
        server.config.id,
        tool.name,
        tool.fingerprint,
        "deny",
      );
    for (const tool of server.tools.filter((t) =>
      ["observe", "locate_player", "job_status", "follow_player"].includes(
        t.name,
      ),
    ))
      await window.eva.mcpGrant(
        server.config.id,
        tool.name,
        tool.fingerprint,
        "allow",
      );
    await window.eva.send("Observe test");
    await window.eva.saveLandmark("Smoke test location");
  });
  assert.equal(
    (await win.evaluate(() => window.eva.snapshot())).mcp.audit.at(-1).outcome,
    "succeeded",
  );
  if (process.env.EVA_MC_LOOKUP === "yes") {
    await win.evaluate(() => window.eva.send("Locate test"));
    console.log("Player lookup:", JSON.stringify(lookupResult));
    assert.ok(lookupResult?.position, "Lookup must return actual coordinates.");
    assert.equal(
      lookupResult.source,
      "operator",
      "For this test the player must be beyond tracking range, so the operator query is actually exercised.",
    );
  }
  if (process.env.EVA_MC_PLAYER) {
    await win.evaluate(() => window.eva.send("Follow test"));
    await expect
      .poll(
        async () =>
          (await win.evaluate(() => window.eva.snapshot())).minecraft.live.job
            ?.status,
      )
      .toBe("running");
    await win.evaluate(() => window.eva.send("Can we chat while following?"));
    // Starting a job is not proof that following works: require actual proximity.
    await expect
      .poll(
        async () => {
          const live = (await win.evaluate(() => window.eva.snapshot()))
            .minecraft.live;
          if (live.job?.status !== "running")
            throw new Error(`Follow failed: ${live.job?.detail}`);
          const target = live.nearby.find(
            (p) => p.name === process.env.EVA_MC_PLAYER,
          );
          if (!target || !live.position) return false;
          return (
            Math.hypot(
              target.position.x - live.position.x,
              target.position.y - live.position.y,
              target.position.z - live.position.z,
            ) <= 4
          );
        },
        {
          timeout: process.env.EVA_MC_LOOKUP === "yes" ? 120000 : 25000,
          message:
            "Bot must actually reach the player, not just report a running job.",
        },
      )
      .toBe(true);
    const moved = (await win.evaluate(() => window.eva.snapshot())).minecraft
      .live;
    console.log(
      "Verified follow arrival:",
      JSON.stringify({ position: moved.position, detail: moved.job?.detail }),
    );
    await win.evaluate(() => window.eva.minecraftAction("stop"));
    await expect
      .poll(
        async () =>
          (await win.evaluate(() => window.eva.snapshot())).minecraft.live.job
            ?.status,
      )
      .toBe("cancelled");
  }
  await win.evaluate(() => window.eva.openSettings());
  await expect
    .poll(() => app.windows().some((w) => w.url().includes("window=settings")))
    .toBe(true);
  const settings = app
    .windows()
    .find((w) => w.url().includes("window=settings"));
  await settings
    .getByRole("button", { name: "Plugins & MCP", exact: true })
    .click();
  await expect(
    settings.getByRole("heading", { name: "Minecraft companion" }),
  ).toBeVisible();
  await settings.screenshot({
    path: "test-results/minecraft-live.png",
    fullPage: true,
  });
  await win.evaluate(() => window.eva.stopTools());
  snapshot = await win.evaluate(() => window.eva.snapshot());
  assert.equal(snapshot.minecraft.live.connected, false);
  assert.equal(
    snapshot.mcp.servers.find((s) => s.config.id === "builtin-minecraft").config
      .enabled,
    false,
  );
  console.log(
    `Minecraft live smoke passed: app-managed process, 26.1 LAN join, observation, inventory, landmarks, emergency disconnect. ${process.env.EVA_MC_PLAYER ? "Concurrent chat/follow/stop verified." : "Follow not requested."} No block changes or public chat requested.`,
  );
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
