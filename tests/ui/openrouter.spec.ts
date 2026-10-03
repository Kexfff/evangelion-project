import { test, expect } from "@playwright/test";
import { defaultSettings } from "../../src/shared/schema";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((defaults) => {
    const data: any = {
      settings:
        JSON.parse(localStorage.getItem("routing-fixture") ?? "null") ??
        defaults,
      facts: [],
      messages: [],
      sessionId: "fixture",
      busy: false,
      secretStorage: "local-file",
    };
    Object.assign(window, {
      routingFixture: data,
      eva: {
        snapshot: async () => structuredClone(data),
        presence: async () => {},
        onEvent: () => () => {},
        assetUrl: (asset: string) =>
          asset === "builtin:eva"
            ? "/AvatarSample_B.vrm"
            : `/animations/${asset.slice(10)}.vrma`,
        saveSettings: async (settings: unknown) => {
          data.settings = settings;
          localStorage.setItem("routing-fixture", JSON.stringify(settings));
        },
        listOpenRouterProviders: async (model: string) => {
          data.requestedModel = model;
          if (data.fail) throw new Error("Fixture discovery failed");
          if (data.delay)
            return new Promise((resolve) => {
              data.resolve = resolve;
            });
          return [
            {
              id: "deepinfra/fp4",
              name: "DeepInfra",
              tools: true,
              inputPrice: "0.000001",
              outputPrice: "0.000002",
            },
            { id: "streamlake", name: "StreamLake", tools: false },
          ];
        },
      },
    });
  }, defaultSettings);
  await page.goto("/?window=settings");
  await page.getByRole("button", { name: "Providers", exact: true }).click();
});

test("fetches for the draft model, selects exact endpoints and retains per-model choices after reload", async ({
  page,
}) => {
  const model = page.getByLabel("Model ID", { exact: true }).first();
  await model.fill("deepseek/deepseek-chat");
  await page
    .getByRole("button", { name: "Fetch providers", exact: true })
    .click();
  expect(
    await page.evaluate(() => (window as any).routingFixture.requestedModel),
  ).toBe("deepseek/deepseek-chat");
  await expect(
    page.getByText("Tools advertised · Input $1 / Output $2 per 1M tokens"),
  ).toBeVisible();
  await page.getByLabel("Use deepinfra/fp4", { exact: true }).check();
  await expect(
    page.getByLabel("OpenRouter routing", { exact: true }),
  ).toHaveValue("only");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Providers", exact: true }).click();
  await expect(
    page.getByLabel("Use deepinfra/fp4", { exact: true }),
  ).toBeChecked();
  await model.fill("another/model");
  await expect(
    page.getByLabel("OpenRouter routing", { exact: true }),
  ).toHaveValue("auto");
  await model.fill("deepseek/deepseek-chat");
  await expect(
    page.getByLabel("Use deepinfra/fp4", { exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Fetch providers", exact: true })
    .click();
  await page.getByLabel("Use streamlake", { exact: true }).check();
  await page.getByLabel("Search model providers").fill("deepinfra");
  await expect(page.getByLabel("Use streamlake", { exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel("Search model providers").fill("");
  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/openrouter-providers.png",
    fullPage: true,
  });
});

test("empty restrictions cannot save; failures and late results do not reset or cross model choices", async ({
  page,
}) => {
  const model = page.getByLabel("Model ID", { exact: true }).first();
  await model.fill("author/model");
  await page
    .getByLabel("OpenRouter routing", { exact: true })
    .selectOption("only");
  await expect(page.getByRole("alert")).toContainText("Choose at least one");
  await page.getByRole("button", { name: "Save changes" }).click();
  expect(
    await page.evaluate(() => localStorage.getItem("routing-fixture")),
  ).toBeNull();
  await page
    .getByRole("button", { name: "Fetch providers", exact: true })
    .click();
  await page.getByLabel("Use streamlake", { exact: true }).check();
  await page.evaluate(() => {
    (window as any).routingFixture.fail = true;
  });
  await page
    .getByRole("button", { name: "Refresh providers", exact: true })
    .click();
  await expect(page.getByText("Fixture discovery failed")).toBeVisible();
  await expect(
    page.getByLabel("Use streamlake", { exact: true }),
  ).toBeChecked();
  await page.evaluate(() => {
    (window as any).routingFixture.fail = false;
    (window as any).routingFixture.delay = true;
  });
  await page
    .getByRole("button", { name: "Refresh providers", exact: true })
    .click();
  await model.fill("other/model");
  await page.evaluate(() =>
    (window as any).routingFixture.resolve([
      { id: "old-provider", name: "Old provider" },
    ]),
  );
  await expect(
    page.getByLabel("Use old-provider", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("OpenRouter routing", { exact: true }),
  ).toHaveValue("auto");
  await page
    .getByRole("textbox", { name: /^API base URL/ })
    .first()
    .fill("http://localhost:8000/v1");
  await expect(
    page.getByRole("region", {
      name: "OpenRouter provider routing",
      exact: true,
    }),
  ).toHaveCount(0);
});
