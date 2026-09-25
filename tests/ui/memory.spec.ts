import { test, expect, type Page } from "@playwright/test";
import {
  defaultSettings,
  type Fact,
  type Snapshot,
} from "../../src/shared/schema";

const texts = [
  "I love rainy evenings and the sound of vinyl records.",
  "My favorite Minecraft builds are cozy cherry wood cottages.",
  "I take my tea with honey, never sugar.",
  "I am learning Japanese, a little every day.",
  "Sunday mornings are for long walks and small cafés.",
  "My cat is called Luna. She usually sits beside my keyboard.",
  "I prefer a gentle check-in when I am busy working.",
  "My favorite season is autumn.",
];
async function openMemory(page: Page, count = 8) {
  const settings = structuredClone(defaultSettings);
  settings.memory.semanticEnabled = true;
  settings.providers.embedding.enabled = true;
  const facts: Fact[] = Array.from({ length: count }, (_, i) => ({
    id: `fact-${i}`,
    characterId: settings.activeCharacterId,
    text: texts[i % texts.length] + (i >= texts.length ? ` Detail ${i}.` : ""),
    source: i % 2 ? "conversation" : "manual",
    createdAt: "2026-09-25T10:00:00.000Z",
    updatedAt: new Date(Date.UTC(2026, 8, 25, 10, 0, count - i)).toISOString(),
  }));
  const snapshot: Snapshot = {
    settings,
    facts,
    messages: [],
    sessionId: "memory-test",
    busy: false,
    secretStorage: "local-file",
  };
  // Include a foreign character's fact to catch accidental cross-character display.
  snapshot.facts.push({
    ...facts[0],
    id: "foreign",
    characterId: "another-character",
    text: "PRIVATE OTHER CHARACTER",
    source: "manual",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
  });
  await page.addInitScript((data) => {
    let listener: (event: unknown) => void = () => {};
    const publish = () =>
      listener({ type: "state", state: structuredClone(data) });
    const calls: string[] = [];
    Object.assign(window, {
      memoryTestCalls: calls,
      eva: {
        listHistory: async () => ({
          sessions: [],
          total: 0,
          totalMessages: 0,
          totalSessions: 0,
        }),
        snapshot: async () => structuredClone(data),
        onEvent: (fn: typeof listener) => {
          listener = fn;
          return () => {};
        },
        assetUrl: (asset: string) =>
          asset === "builtin:eva"
            ? "/Eva.vrm"
            : `/animations/${asset.slice(10)}.vrma`,
        saveSettings: async (settings: typeof data.settings) => {
          data.settings = settings;
          publish();
        },
        saveFact: async (fact: { id?: string; text: string }) => {
          if (fact.text === "FAIL_SAVE")
            throw new Error("Could not save memory.");
          const existing = data.facts.find((f) => f.id === fact.id);
          if (existing) {
            existing.text = fact.text;
            existing.updatedAt = new Date().toISOString();
          } else
            data.facts.push({
              id: "added",
              characterId: data.settings.activeCharacterId,
              text: fact.text,
              source: "manual",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          publish();
        },
        deleteFact: async (id: string) => {
          data.facts = data.facts.filter((f) => f.id !== id);
          publish();
        },
        reindexMemory: async () => {
          calls.push("reindex");
          return { indexed: 8, total: 8 };
        },
        importMemory: async () => {
          calls.push("import");
          return false;
        },
        exportMemory: async () => {
          calls.push("export");
          return true;
        },
        newSession: async () => {
          calls.push("session");
        },
      },
    });
  }, snapshot);
  await page.goto("/?window=settings");
  await page.getByRole("button", { name: "Memory", exact: true }).click();
}

test("memory constellation explores real facts locally; library filters and searches", async ({
  page,
}) => {
  await openMemory(page);
  await expect(page.locator(".memory-item")).toHaveCount(8);
  await expect(page.locator(".memory-star")).toHaveCount(8);
  await expect(page.getByText("PRIVATE OTHER CHARACTER")).toHaveCount(0);
  await expect(page.getByText("Meaning-based recall enabled")).toBeVisible();
  await expect(
    page.getByText("Illustrative, not an embedding map.", { exact: false }),
  ).toBeVisible();
  const star = page.getByRole("button", {
    name: `Preview memory: ${texts[2]}`,
    exact: true,
  });
  await star.focus();
  await page.keyboard.press("Enter");
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".memory-preview")).toContainText(texts[2]);
  await page
    .getByRole("button", { name: "From conversation 4", exact: true })
    .click();
  await expect(page.locator(".memory-item")).toHaveCount(4);
  await page
    .getByRole("searchbox", { name: "Search memories" })
    .fill("  MINECRAFT  ");
  await expect(page.locator(".memory-item")).toHaveCount(1);
  await page.getByRole("searchbox").fill("not a memory");
  await expect(page.getByText("No memories here just yet")).toBeVisible();
  await page.getByRole("button", { name: "Show all memories" }).click();
  await expect(page.locator(".memory-item")).toHaveCount(8);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { memoryTestCalls: string[] }).memoryTestCalls,
    ),
  ).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/memory-desktop.png",
    fullPage: true,
  });
});

test("memory edits, failed saves and confirmed deletion keep the collection consistent", async ({
  page,
}) => {
  await openMemory(page);
  const editor = page.getByRole("textbox", {
    name: "What should she remember?",
  });
  await page
    .locator(".memory-item")
    .first()
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue(texts[0]);
  await editor.fill("FAIL_SAVE");
  await page.getByRole("button", { name: "Update memory" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not save memory");
  await expect(editor).toHaveValue("FAIL_SAVE");
  await expect(page.locator(".memory-item").first()).toContainText(texts[0]);
  await editor.fill("I prefer jasmine tea.");
  await page.getByRole("button", { name: "Update memory" }).click();
  await expect(page.locator(".memory-preview")).toContainText(
    "I prefer jasmine tea.",
  );
  await expect(editor).toHaveValue("");
  const deletion = page.getByRole("button", {
    name: "Delete memory: I prefer jasmine tea.",
  });
  await deletion.click();
  await expect(page.locator(".memory-item")).toHaveCount(8);
  await page.getByRole("button", { name: "Keep memory" }).click();
  await deletion.click();
  await page.getByRole("button", { name: "Confirm delete memory" }).click();
  await expect(page.locator(".memory-item")).toHaveCount(7);
  await expect(page.locator(".memory-star")).toHaveCount(7);
  await expect(page.locator(".memory-preview")).not.toContainText(
    "I prefer jasmine tea.",
  );
  await page
    .locator(".memory-item")
    .first()
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel edit" }).click();
  await expect(editor).toHaveValue("");
});

test("recall settings stay explicit and archive actions retain their behavior", async ({
  page,
}) => {
  await openMemory(page);
  await expect(
    page.getByRole("slider", { name: "Minimum semantic similarity" }),
  ).not.toBeVisible();
  await page.getByText("Fine-tune recall", { exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "Minimum semantic similarity" }),
  ).toBeVisible();
  const index = page.getByRole("button", {
    name: "Build / update semantic index",
  });
  await index.click();
  await expect(page.locator(".success-notice")).toContainText("8 of 8");
  await page
    .getByRole("checkbox", { name: "Semantic memory", exact: false })
    .uncheck();
  await expect(index).toBeDisabled();
  // The status reflects saved settings, not an unsaved toggle.
  await expect(page.getByText("Meaning-based recall enabled")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Keyword recall", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(
    page.getByText("Memories imported.", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.locator(".success-notice")).toContainText(
    "without API keys",
  );
  await page
    .getByRole("button", { name: "Conversation history", exact: true })
    .click();
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Saved facts 8", exact: true })
    .click();
  await expect(page.locator(".memory-item")).toHaveCount(8);
});

test("large collections are bounded, responsive and respect reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openMemory(page, 45);
  await expect(page.locator(".memory-star")).toHaveCount(36);
  await expect(page.locator(".memory-item")).toHaveCount(12);
  await page.getByRole("button", { name: /Show more memories/ }).click();
  await expect(page.locator(".memory-item")).toHaveCount(24);
  expect(
    await page
      .locator(".constellation-haze")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await page.setViewportSize({ width: 760, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/memory-narrow.png",
    fullPage: false,
  });
  for (const width of [1000, 760, 480]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page
        .locator(".memory-workspace")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await expect(
      page.getByRole("textbox", { name: "What should she remember?" }),
    ).toBeVisible();
  }
  await page.getByRole("searchbox").fill("Detail 44.");
  await expect(page.locator(".memory-item")).toHaveCount(1);
});

test("an empty constellation grows with the first memory without inventing sample facts", async ({
  page,
}) => {
  await openMemory(page, 0);
  await expect(page.locator(".memory-star")).toHaveCount(0);
  await expect(
    page.getByText("A little universe, waiting to grow."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Write the first memory" }).click();
  const editor = page.getByRole("textbox", {
    name: "What should she remember?",
  });
  await expect(editor).toBeFocused();
  await editor.fill("   ");
  await expect(
    page.getByRole("button", { name: "Add memory", exact: true }),
  ).toBeDisabled();
  await editor.fill("I enjoy stargazing.");
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  await expect(page.locator(".memory-star")).toHaveCount(1);
  await expect(page.locator(".memory-item")).toContainText(
    "I enjoy stargazing.",
  );
  await expect(page.locator(".memory-preview")).toContainText(
    "I enjoy stargazing.",
  );
  await expect(
    page.getByText("A little universe, waiting to grow."),
  ).toHaveCount(0);
});
