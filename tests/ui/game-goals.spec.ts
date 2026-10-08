import { test, expect } from "@playwright/test";
import { defaultSettings } from "../../src/shared/schema";
import { minecraftConfigSchema } from "../../src/shared/minecraft";
import { gameGoalConfigSchema } from "../../src/shared/game-goals";
import { gameAutonomyStateSchema } from "../../src/shared/game-autonomy";

test("game goals queue, pause, reconcile, cancel and save independent budgets", async ({
  page,
}) => {
  await page.addInitScript(
    ({ settings, config, goalConfig, autonomy }) => {
      let listener = (_event: unknown) => {};
      const data: any = {
        settings,
        facts: [],
        messages: [],
        sessionId: "fixture",
        busy: false,
        secretStorage: "local-file",
        minecraft: {
          autonomy,
          config,
          goalConfig,
          goals: [],
          projects: [],
          jobs: [],
          landmarks: [],
          live: {
            connected: true,
            status: "Connected",
            inventory: [],
            players: [],
            nearby: [],
            position: { x: 0, y: 64, z: 0 },
            health: 20,
            food: 20,
          },
        },
      };
      const emit = () =>
        listener({ type: "state", state: structuredClone(data) });
      Object.assign(window, {
        goalFixture: data,
        eva: {
          snapshot: async () => structuredClone(data),
          presence: async () => {},
          onEvent: (fn: typeof listener) => {
            listener = fn;
            return () => {};
          },
          assetUrl: (asset: string) =>
            asset === "builtin:eva"
              ? "/AvatarSample_B.vrm"
              : `/animations/${asset.slice(10)}.vrma`,
          submitGameGoal: async (input: any) => {
            data.lastSubmitted = input;
            data.minecraft.goals.push({
              ...input,
              id: "fixture-goal",
              status: "queued",
              detail: "Queued",
              steps: 0,
              requests: 0,
              cost: 0,
              source: "desktop",
              history: [],
            });
            emit();
          },
          saveGameProject: async (input: any) => {
            const project = {
              ...input,
              id: input.id ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              world: "test",
              characterId: "fixture",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            data.minecraft.projects = [
              ...data.minecraft.projects.filter(
                (p: any) => p.id !== project.id,
              ),
              project,
            ];
            emit();
          },
          controlGameGoal: async (_id: string, action: string) => {
            data.minecraft.goals[0].status = {
              pause: "paused",
              resume: "queued",
              cancel: "cancelled",
            }[action];
            if (action === "cancel")
              data.minecraft.goals[0].history = [
                {
                  tool: "craft_item",
                  args: {},
                  outcome: "Approach interrupted",
                  diagnostics: [
                    {
                      position: { x: -1056, y: 66, z: 296 },
                      startedAt: "2026-10-05T12:00:00Z",
                      elapsedMs: 91000,
                      outcome: "interrupted",
                    },
                  ],
                },
              ];
            emit();
          },
          configureGameGoals: async (cfg: unknown) => {
            data.minecraft.goalConfig = cfg;
            emit();
          },
          configureGameAutonomy: async (cfg: unknown) => {
            data.minecraft.autonomy.config = cfg;
            emit();
          },
          pauseGameAutonomy: async (paused: boolean) => {
            data.minecraft.autonomy.config.paused = paused;
            emit();
          },
        },
      });
    },
    {
      settings: defaultSettings,
      config: minecraftConfigSchema.parse({}),
      goalConfig: gameGoalConfigSchema.parse({}),
      autonomy: gameAutonomyStateSchema.parse({}),
    },
  );
  await page.goto("/?window=settings");
  await page
    .getByRole("button", { name: "Plugins & MCP", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Game goals", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Choose activities autonomously").check();
  await page
    .getByRole("combobox", { name: "Play style", exact: true })
    .selectOption("objective");
  await page
    .getByLabel("Standing objective & preferences")
    .fill("Build us a cozy home");
  await page.getByText("Shared game budget", { exact: true }).click();
  await page
    .getByLabel("Requests per rolling hour", { exact: true })
    .fill("80");
  await page.getByRole("button", { name: "Save independent gameplay" }).click();
  expect(
    await page.evaluate(
      () => (window as any).goalFixture.minecraft.autonomy.config,
    ),
  ).toMatchObject({
    enabled: true,
    preference: "objective",
    objective: "Build us a cozy home",
    hourlyRequests: 80,
  });
  await page
    .getByRole("button", { name: "Pause gameplay", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume gameplay", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Resume gameplay", exact: true })
    .click();
  await page.getByText("Shared game budget", { exact: true }).click();
  await page.screenshot({
    path: "/tmp/eva-independent-gameplay.png",
    fullPage: true,
  });
  await page.getByText("New inventory goal", { exact: true }).click();
  await expect(page.getByLabel("Scheduled start (optional)")).toBeDisabled();
  await page.getByLabel("Target item ID").fill("oak_log");
  await page.getByLabel("Target quantity").fill("16");
  await page
    .getByLabel("Goal description (optional)")
    .fill("Gather wood for our house");
  await page
    .getByRole("button", { name: "Start game goal", exact: true })
    .click();
  expect(
    await page.evaluate(() => (window as any).goalFixture.lastSubmitted),
  ).toEqual({
    objective: "Gather wood for our house",
    completion: [{ kind: "inventory", item: "oak_log", count: 16 }],
    mode: "queue",
  });
  await page.getByRole("button", { name: "Pause goal", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume goal", exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Resume goal", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause goal", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel goal", exact: true }).click();
  await expect(
    page.locator('.game-goals [data-status="cancelled"]'),
  ).toContainText("Gather wood for our house");
  await page.getByText("Step history", { exact: true }).click();
  await page
    .getByText("Crafting-table approaches · 1", { exact: true })
    .click();
  await expect(
    page.locator(".game-goals .minecraft-diagnostics"),
  ).toContainText("(-1056, 66, 296)");
  await expect(
    page.locator(".game-goals .minecraft-diagnostics"),
  ).toContainText("Stopped before approach completed");
  await page.getByText("Planning budgets & reactions", { exact: true }).click();
  await page.getByLabel("Maximum steps", { exact: true }).fill("12");
  await page
    .getByLabel("No-progress timeout (seconds)", { exact: true })
    .fill("120");
  await page.getByLabel("Enable scheduled game goals").check();
  await page.getByLabel("Enable survival reactions").check();
  await page
    .getByRole("button", { name: "Save game planning settings" })
    .click();
  await expect(page.getByLabel("Scheduled start (optional)")).toBeEnabled();
  expect(
    await page.evaluate(() => (window as any).goalFixture.minecraft.goalConfig),
  ).toMatchObject({
    maxSteps: 12,
    stepSeconds: 120,
    scheduled: true,
    survival: true,
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByText("New world project", { exact: true }).click();
  await page
    .getByLabel("Project title", { exact: true })
    .fill("Our first home");
  await page
    .getByLabel("Purpose / next milestone")
    .fill("Gather the materials for our home");
  await page
    .getByLabel("Resource targets (up to 8, one per line)")
    .fill("oak_log 16\ncobblestone 32");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Our first home" }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "oak_log stock" }),
  ).toHaveAttribute("max", "16");
  await page
    .getByRole("button", { name: "Work on targets", exact: true })
    .click();
  expect(
    await page.evaluate(() => (window as any).goalFixture.lastSubmitted),
  ).toMatchObject({
    projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    completion: [
      { kind: "inventory", item: "oak_log", count: 16 },
      { kind: "inventory", item: "cobblestone", count: 32 },
    ],
  });
  await expect(
    page.getByRole("button", { name: "Goal in progress" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Pause project", exact: true })
    .click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Our first home" }),
  ).toHaveCount(0);
  await page.getByLabel("Show archived projects").check();
  await expect(
    page.getByRole("heading", { name: "Our first home" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Project title", { exact: true }).fill("Our cozy home");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Our cozy home" }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/eva-game-projects.png", fullPage: true });
  await page
    .locator(".game-projects")
    .screenshot({ path: "/tmp/eva-project-cards.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});
