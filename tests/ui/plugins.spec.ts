import { test, expect } from "@playwright/test";
import { defaultSettings } from "../../src/shared/schema";
import { telegramStateSchema } from "../../src/shared/plugins";

test("plugin preview explains desktop installation and trust boundaries", async ({
  page,
}) => {
  await page.goto("/?window=settings");
  await page
    .getByRole("button", { name: "Plugins & MCP", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Telegram plugin" }),
  ).toBeVisible();
  await expect(
    page.getByText("Trusted built-in adapters only.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Install bundled Telegram" }).click();
  await expect(page.getByRole("alert")).toContainText("browser preview");
});

test("installed plugin UI defaults off, scopes optional permissions and validates pairing flow", async ({
  page,
}) => {
  const data = {
    settings: defaultSettings,
    facts: [],
    messages: [],
    sessionId: "test",
    busy: false,
    secretStorage: "local-file",
    plugins: {
      ...telegramStateSchema.parse({ installedVersion: "1.0.0" }),
      status: "Disabled",
      hasToken: false,
      availableVersion: "1.0.0",
    },
  };
  await page.addInitScript((snapshot) => {
    let listener: (event: unknown) => void = () => {};
    const publish = () =>
      listener({ type: "state", state: structuredClone(snapshot) });
    Object.assign(window, {
      eva: {
        snapshot: async () => structuredClone(snapshot),
        onEvent: (fn: typeof listener) => {
          listener = fn;
          return () => {};
        },
        assetUrl: (asset: string) =>
          asset === "builtin:eva"
            ? "/Eva.vrm"
            : `/animations/${asset.slice(10)}.vrma`,
        configureTelegram: async (
          config: typeof snapshot.plugins.config,
          token?: string,
        ) => {
          snapshot.plugins.config = config;
          snapshot.plugins.hasToken = !!token;
          snapshot.plugins.status = config.enabled ? "Connected" : "Disabled";
          publish();
        },
        pluginAction: async (action: string) => {
          if (action === "pair")
            return "/start 01234567890123456789012345678901";
          if (action === "disable") {
            snapshot.plugins.config.enabled = false;
            snapshot.plugins.status = "Disabled";
            publish();
          }
        },
      },
    });
  }, data);
  await page.goto("/?window=settings");
  await page
    .getByRole("button", { name: "Plugins & MCP", exact: true })
    .click();
  await expect(
    page.getByLabel("Enable Telegram", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByLabel("Send voice replies in addition to text"),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Generate pairing command" }),
  ).toBeDisabled();
  await page.getByLabel("Bot token", { exact: true }).fill("not-a-real-token");
  await page
    .getByLabel("Chat — shared character history and memory (required)")
    .check();
  await page
    .getByLabel("Voice — send voice notes to ASR and generate TTS replies")
    .check();
  await page.getByLabel("Send voice replies in addition to text").check();
  await page
    .getByLabel("Voice — send voice notes to ASR and generate TTS replies")
    .uncheck();
  await expect(
    page.getByLabel("Send voice replies in addition to text"),
  ).not.toBeChecked();
  await page.getByLabel("Enable Telegram", { exact: true }).check();
  await page
    .getByRole("button", { name: "Save Telegram configuration" })
    .click();
  await expect(page.getByLabel("Bot token", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Generate pairing command" }).click();
  await expect(
    page.getByLabel("One-time pairing command (expires in 5 minutes)"),
  ).toHaveValue(/^\/start /);
  await page.getByRole("button", { name: "Disable immediately" }).click();
  await expect(
    page.getByLabel("Enable Telegram", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByLabel("One-time pairing command (expires in 5 minutes)"),
  ).toHaveCount(0);
});
