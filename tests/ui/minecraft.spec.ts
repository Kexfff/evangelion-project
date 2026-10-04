import { test, expect } from "@playwright/test";
import { defaultSettings } from "../../src/shared/schema";
import {
  minecraftConfigSchema,
  minecraftTools,
} from "../../src/shared/minecraft";

test("Minecraft preview explains allow-by-default and has no duplicate block/chat gates", async ({
  page,
}) => {
  await page.goto("/?window=settings");
  await page
    .getByRole("button", { name: "Plugins & MCP", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Minecraft companion" }),
  ).toBeVisible();
  await expect(page.getByLabel("Minecraft port", { exact: true })).toHaveValue(
    "25556",
  );
  await expect(
    page.getByLabel("Allow block changes inside the build area"),
  ).toHaveCount(0);
  await expect(
    page.getByText("Minecraft actions are allowed by default.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByText("Optional gameplay limits", { exact: true }).click();
  await page.getByLabel("Movement radius (0 = no leash)").fill("32");
  await page.getByLabel("Job timeout seconds (0 = until stopped)").fill("30");
  await page
    .getByRole("button", { name: "Use companion movement defaults" })
    .click();
  await expect(page.getByLabel("Movement radius (0 = no leash)")).toHaveValue(
    "0",
  );
  await expect(
    page.getByLabel("Job timeout seconds (0 = until stopped)"),
  ).toHaveValue("0");
  await expect(
    page.getByRole("button", { name: "Join world", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Build center X")).toBeVisible();
  await expect(
    page.getByText("Block changes can permanently alter your world.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel(
      "Free play (navigation may change terrain when block changes are allowed)",
    ),
  ).toHaveCount(0);
  await expect(page.getByLabel("Build radius (0 = anywhere)")).toHaveValue("0");
  await expect(page.getByLabel("Maximum blocks per job")).toHaveValue("1024");
  await expect(page.getByLabel("Allow public Minecraft chat")).toHaveCount(0);
  await expect(
    page.getByLabel(
      "Operator coordinate lookup (requires cheats / operator permission)",
    ),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "Save Minecraft configuration" })
    .click();
  await expect(page.getByRole("alert")).toContainText("browser preview");
});

test("Minecraft jobs, stop control and world landmarks stay separate from chat", async ({
  page,
}) => {
  const config = minecraftConfigSchema.parse({
    trustedPlayer: "Player",
    movement: true,
  });
  await page.addInitScript(
    ({ config, tools }) => {
      let listener: (event: unknown) => void = () => {};
      const job = {
        id: "job",
        kind: "follow",
        status: "running",
        progress: 0,
        total: 0,
        detail: "Following Player",
        startedAt: "2026-10-03T00:00:00Z",
        updatedAt: "2026-10-03T00:00:00Z",
        worldId: config.worldId,
        characterId: "eva",
      };
      const snapshot = {
        settings: {},
        facts: [],
        messages: [],
        sessionId: "fixture",
        busy: false,
        secretStorage: "local-file",
        minecraft: {
          enabled: true,
          config,
          live: {
            status: "Connected",
            connected: true,
            position: { x: 0, y: 64, z: 0 },
            dimension: "overworld",
            health: 20,
            food: 20,
            players: ["Player"],
            inventory: [{ name: "dirt", count: 10 }],
            nearby: [],
            job,
          },
          jobs: [
            job,
            {
              ...job,
              id: "crafted",
              kind: "craft",
              status: "succeeded",
              detail: "Crafted oak_planks",
              result: { operations: 2, outputGain: 8 },
            },
          ],
          landmarks: [] as any[],
        },
        mcp: {
          stopped: false,
          pending: [],
          audit: [],
          servers: [
            {
              config: {
                id: "builtin-minecraft",
                name: "Minecraft (bundled)",
                command: "bundled:minecraft",
                args: [],
                transport: "stdio",
                url: "",
                enabled: true,
                characterId: "eva",
              },
              status: "Connected",
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                policy: "deny",
                fingerprint: "a".repeat(64),
              })),
              hasSecrets: false,
            },
          ],
        },
      };
      Object.assign(window, {
        mcFixture: snapshot,
        eva: {
          snapshot: async () => structuredClone(snapshot),
          presence: async () => {},
          onEvent: (fn: typeof listener) => {
            listener = fn;
            return () => {};
          },
          mcpGrant: async (
            _id: string,
            name: string,
            _fingerprint: string,
            policy: string,
          ) => {
            snapshot.mcp.servers[0].tools.find((t) => t.name === name)!.policy =
              policy;
            listener({ type: "state", state: structuredClone(snapshot) });
          },
          assetUrl: (asset: string) =>
            asset === "builtin:eva"
              ? "/AvatarSample_B.vrm"
              : `/animations/${asset.slice(10)}.vrma`,
          minecraftAction: async () => {
            job.status = "cancelled";
            job.detail = "Stopped by user.";
            listener({ type: "state", state: structuredClone(snapshot) });
          },
          setMinecraftEnabled: async (enabled: boolean) => {
            snapshot.minecraft.enabled = enabled;
            snapshot.minecraft.live.connected = false;
            snapshot.minecraft.live.status = enabled
              ? "Not connected"
              : "Minecraft plugin is off";
            listener({ type: "state", state: structuredClone(snapshot) });
          },
          saveLandmark: async (name: string) => {
            snapshot.minecraft.landmarks.push({
              id: "landmark",
              name,
              worldId: config.worldId,
              dimension: "overworld",
              position: snapshot.minecraft.live.position,
            });
            listener({ type: "state", state: structuredClone(snapshot) });
          },
        },
      });
    },
    { config, tools: minecraftTools },
  );
  await page.addInitScript((settings) => {
    (window as any).mcFixture.settings = settings;
  }, defaultSettings);
  await page.goto("/?window=settings");
  await page
    .getByRole("button", { name: "Plugins & MCP", exact: true })
    .click();
  await expect(page.getByText("follow · running")).toBeVisible();
  await page.getByText("Action result", { exact: true }).click();
  await expect(page.locator(".minecraft-jobs pre")).toContainText(
    '"outputGain": 8',
  );
  await page.getByRole("button", { name: "Enable everyday controls" }).click();
  await page.getByText("Individual tool permissions", { exact: true }).click();
  await page.getByRole("button", { name: "Survive", exact: true }).click();
  await expect(page.locator(".tool-result-count").first()).toHaveText(
    "6 of 26 tools",
  );
  await page.getByLabel("Search Minecraft tools").fill("sleep");
  await expect(
    page.getByLabel("Minecraft permission for sleep", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Minecraft permission for attack_entity", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Search Minecraft tools").fill("nothing-matches");
  await expect(
    page.getByRole("heading", { name: "No matching tools" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  for (const name of [
    "observe",
    "move_to",
    "follow_player",
    "job_status",
    "stop_action",
  ])
    await expect(
      page.getByLabel(`Minecraft permission for ${name}`, { exact: true }),
    ).toHaveValue("allow");
  for (const name of ["collect_blocks", "build_blocks", "say_in_game"])
    await expect(
      page.getByLabel(`Minecraft permission for ${name}`, { exact: true }),
    ).toHaveValue("deny");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Enable all game tools" }).click();
  for (const { name } of minecraftTools)
    await expect(
      page.getByLabel(`Minecraft permission for ${name}`, { exact: true }),
    ).toHaveValue("allow");
  await page
    .getByLabel("Filter Minecraft tools by permission")
    .selectOption("deny");
  await expect(
    page.getByRole("heading", { name: "No matching tools" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await page.getByRole("button", { name: "Stop game action" }).click();
  await expect(page.getByText("follow · cancelled")).toBeVisible();
  await page.getByText("World landmarks", { exact: true }).click();
  await page.getByLabel("Landmark name").fill("Our base");
  await page.getByRole("button", { name: "Remember current location" }).click();
  await expect(
    page.getByRole("button", { name: "Delete Our base" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 900, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/settings-minecraft.png",
    fullPage: true,
  });
  await page.getByLabel("Enable Minecraft plugin", { exact: true }).uncheck();
  await expect(
    page.getByRole("button", { name: "Join world", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Minecraft", exact: true }),
  ).toContainText("Plugin off");
  await page.getByText("New inventory goal", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start game goal", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Enable Minecraft plugin", { exact: true }).check();
  await expect(
    page.getByRole("button", { name: "Join world", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => (window as any).mcFixture.minecraft.live.connected,
    ),
  ).toBe(false);
  await page.goto("/?window=companion");
  await expect(
    page.getByRole("status").filter({ hasText: "Minecraft:" }),
  ).toContainText("Following Player");
  await expect(
    page.getByRole("status").filter({ hasText: "Minecraft:" }),
  ).not.toContainText("in progress");
  await page.getByRole("button", { name: "Stop game action" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Minecraft:" }),
  ).toHaveCount(0);
});
