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
          controlGameGoal: async (_id: string, action: string) => {
            data.minecraft.goals[0].status = {
              pause: "paused",
              resume: "queued",
              cancel: "cancelled",
            }[action];
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
  await page.getByText("Planning budgets & reactions", { exact: true }).click();
  await page.getByLabel("Maximum steps", { exact: true }).fill("12");
  await page.getByLabel("Enable scheduled game goals").check();
  await page.getByLabel("Enable survival reactions").check();
  await page
    .getByRole("button", { name: "Save game planning settings" })
    .click();
  await expect(page.getByLabel("Scheduled start (optional)")).toBeEnabled();
  expect(
    await page.evaluate(() => (window as any).goalFixture.minecraft.goalConfig),
  ).toMatchObject({ maxSteps: 12, scheduled: true, survival: true });
  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});
