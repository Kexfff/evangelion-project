import { test, expect, type Page } from "@playwright/test";
import {
  defaultSettings,
  type Message,
  type Snapshot,
} from "../../src/shared/schema";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1kAAAAASUVORK5CYII=";
function archive(): Message[] {
  return [
    {
      id: "current-user",
      characterId: "eva",
      sessionId: "current",
      role: "user",
      content: "Let’s plan our weekend",
      createdAt: "2026-09-25T10:00:00.000Z",
    },
    {
      id: "current-reply",
      characterId: "eva",
      sessionId: "current",
      role: "assistant",
      content: "How about a walk by the river?",
      createdAt: "2026-09-25T10:00:01.000Z",
    },
    {
      id: "old-user",
      characterId: "eva",
      sessionId: "old",
      role: "user",
      content: "Our garden in Minecraft",
      images: [{ name: "garden.png", dataUrl: png }],
      channel: "telegram",
      createdAt: "2026-09-12T14:00:00.000Z",
    },
    {
      id: "old-reply",
      characterId: "eva",
      sessionId: "old",
      role: "assistant",
      content: "The cherry trees look beautiful!",
      channel: "desktop",
      createdAt: "2026-09-12T14:00:02.000Z",
    },
    {
      id: "foreign",
      characterId: "other",
      sessionId: "old",
      role: "user",
      content: "SECRET FOREIGN CHAT",
      createdAt: "2026-09-25T15:00:00.000Z",
    },
  ];
}
async function openHistory(
  page: Page,
  options: { empty?: boolean; many?: boolean; fail?: boolean } = {},
) {
  const messages = options.empty ? [] : archive();
  if (options.many) {
    for (let i = 0; i < 45; i++)
      messages.push({
        id: `long-${i}`,
        characterId: "eva",
        sessionId: "long",
        role: i % 2 ? "assistant" : "user",
        content: `Long conversation message ${i}`,
        createdAt: new Date(Date.UTC(2026, 8, 2, 10, i)).toISOString(),
      });
    for (let i = 0; i < 22; i++)
      messages.push({
        id: `extra-${i}`,
        characterId: "eva",
        sessionId: `extra-${i}`,
        role: "user",
        content: `Older chat ${i}`,
        createdAt: new Date(Date.UTC(2026, 7, i + 1)).toISOString(),
      });
  }
  const snapshot: Snapshot = {
    settings: structuredClone(defaultSettings),
    messages: messages.filter((m) => m.sessionId === "current"),
    facts: [],
    sessionId: "current",
    busy: false,
    secretStorage: "local-file",
  };
  await page.addInitScript(
    ({ snapshot, messages, fail }) => {
      let listener: (event: unknown) => void = () => {};
      let failList = fail;
      let failRead = fail;
      const calls: string[] = [];
      const publish = () =>
        listener({ type: "state", state: structuredClone(snapshot) });
      const modulePath = "/src/shared/history.ts";
      Object.assign(window, {
        historyTestCalls: calls,
        eva: {
          snapshot: async () => structuredClone(snapshot),
          onEvent: (fn: typeof listener) => {
            listener = fn;
            return () => {};
          },
          assetUrl: (asset: string) =>
            asset === "builtin:eva"
              ? "/AvatarSample_B.vrm"
              : `/animations/${asset.slice(10)}.vrma`,
          listHistory: async (query: unknown) => {
            calls.push("list");
            if (failList) {
              failList = false;
              throw new Error("Archive temporarily unavailable");
            }
            return (await import(modulePath)).listHistory(
              messages,
              snapshot.sessionId,
              query,
            );
          },
          readConversation: async (query: { sessionId: string }) => {
            if (failRead) {
              failRead = false;
              throw new Error("Messages temporarily unavailable");
            }
            if (query.sessionId === "old")
              await new Promise((resolve) => setTimeout(resolve, 250));
            return (await import(modulePath)).readConversation(messages, query);
          },
          readHistoryImage: async (query: unknown) => {
            calls.push("image");
            return (await import(modulePath)).readHistoryImage(messages, query);
          },
          newSession: async () => {
            calls.push("new");
            snapshot.sessionId = "fresh";
            snapshot.messages = [];
            publish();
          },
          clearHistory: async () => {
            calls.push("clear-cancelled");
          },
          exportMemory: async () => {
            calls.push("export");
            return true;
          },
        },
      });
    },
    { snapshot, messages, fail: options.fail ?? false },
  );
  await page.goto("/?window=settings");
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await page
    .getByRole("button", { name: "Conversation history", exact: true })
    .click();
}

test("browses archived chats and opens images on demand without changing the active conversation", async ({
  page,
}) => {
  await openHistory(page);
  await expect(
    page.getByText("2 saved conversations", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("4 messages", { exact: true })).toBeVisible();
  await expect(page.locator(".history-session")).toHaveCount(2);
  await expect(page.locator(".history-message")).toHaveCount(2);
  await expect(page.getByText("SECRET FOREIGN CHAT")).toHaveCount(0);
  await page
    .locator(".history-session")
    .filter({ hasText: "Our garden in Minecraft" })
    .click();
  await expect(page.locator(".history-reader")).toContainText(
    "The cherry trees look beautiful!",
  );
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { historyTestCalls: string[] }
      ).historyTestCalls.includes("image"),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "View image: garden.png" }).click();
  await expect(page.getByRole("img", { name: "garden.png" })).toBeVisible();
  await page.getByRole("button", { name: "Close image: garden.png" }).click();
  await expect(page.getByRole("img", { name: "garden.png" })).toHaveCount(0);
  expect(
    await page.evaluate(async () => (await window.eva!.snapshot()).sessionId),
  ).toBe("current");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/conversation-history.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 760, height: 1000 });
  await page.screenshot({
    path: "test-results/conversation-history-narrow.png",
    fullPage: true,
  });
  for (const width of [1000, 760, 480]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page
        .locator(".history-workspace")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  }
});

test("searches message text and image names, filters channels and reads full context", async ({
  page,
}) => {
  await openHistory(page);
  const search = page.getByRole("searchbox", {
    name: "Search conversation history",
  });
  await search.fill("  CHERRY  ");
  await expect(page.locator(".history-session")).toHaveCount(1);
  await expect(page.locator(".history-message")).toHaveCount(1);
  await expect(page.locator(".history-message")).toContainText("cherry trees");
  await page.getByRole("button", { name: "Read full conversation" }).click();
  await expect(page.locator(".history-message")).toHaveCount(2);
  await search.fill("garden.png");
  await expect(page.locator(".history-message")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "View image: garden.png" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Desktop", exact: true }).click();
  await expect(
    page.getByText("No matching conversations", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear history filters" }).click();
  await page.getByRole("button", { name: "Telegram", exact: true }).click();
  await expect(page.locator(".history-session")).toHaveCount(1);
  await expect(page.locator(".history-message")).toHaveCount(1);
});

test("paginates archives and message threads without mixing delayed responses", async ({
  page,
}) => {
  await openHistory(page, { many: true });
  await expect(page.locator(".history-session")).toHaveCount(20);
  await page.getByRole("button", { name: "Next conversations" }).click();
  await expect(page.locator(".history-session")).toHaveCount(5);
  await page.getByRole("button", { name: "Previous conversations" }).click();
  await page
    .locator(".history-session")
    .filter({ hasText: "Long conversation message 0" })
    .click();
  await expect(page.locator(".history-message")).toHaveCount(20);
  await page.getByRole("button", { name: "Next messages" }).click();
  await expect(page.locator(".history-message").first()).toContainText(
    "message 20",
  );
  await page.getByRole("button", { name: "Next messages" }).click();
  await expect(page.locator(".history-message")).toHaveCount(5);
  await page
    .locator(".history-session")
    .filter({ hasText: "Our garden in Minecraft" })
    .click();
  await page
    .locator(".history-session")
    .filter({ hasText: "Let’s plan our weekend" })
    .click();
  await expect(page.locator(".history-message").first()).toContainText(
    "Let’s plan our weekend",
  );
  await page.waitForTimeout(400);
  await expect(page.locator(".history-message").first()).toContainText(
    "Let’s plan our weekend",
  );
});

test("recovers from errors and preserves archives on new chat and cancelled deletion", async ({
  page,
}) => {
  await openHistory(page, { fail: true });
  await expect(page.getByRole("alert")).toContainText(
    "Archive temporarily unavailable",
  );
  await page.getByRole("button", { name: "Retry loading history" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Messages temporarily unavailable",
  );
  await page.getByRole("button", { name: "Retry loading messages" }).click();
  await expect(page.locator(".history-message")).toHaveCount(2);
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(page.locator(".success-notice")).toContainText(
    "Previous conversations and facts are kept",
  );
  await expect(page.locator(".history-session")).toHaveCount(2);
  await expect(page.getByText("Active chat", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Export archive" }).click();
  await expect(page.locator(".success-notice")).toContainText(
    "without API keys",
  );
  await page
    .getByRole("button", { name: "Delete conversation history…" })
    .click();
  await expect(page.locator(".history-session")).toHaveCount(2);
});

test("empty history is clearly separate from facts", async ({ page }) => {
  await openHistory(page, { empty: true });
  await expect(
    page.getByText("0 saved conversations", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Your story starts with a hello")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete conversation history…" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Saved facts 0", exact: true })
    .click();
  await expect(
    page.getByText("A little universe, waiting to grow."),
  ).toBeVisible();
});
