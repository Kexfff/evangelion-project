import { test, expect } from "@playwright/test";
import { defaultSettings, type Snapshot } from "../../src/shared/schema";

test("overview replaces the roadmap with live, character-scoped archive totals", async ({
  page,
}) => {
  const snapshot: Snapshot = {
    settings: structuredClone(defaultSettings),
    messages: [],
    facts: [],
    sessionId: "fresh",
    busy: false,
    secretStorage: "local-file",
    historyStats: { conversations: 12, messages: 1248, images: 37 },
  };
  await page.addInitScript((state) => {
    let listener: (event: unknown) => void = () => {};
    Object.assign(window, {
      updateOverview: (next: typeof state) => {
        state = next;
        listener({ type: "state", state });
      },
      eva: {
        snapshot: async () => structuredClone(state),
        onEvent: (fn: typeof listener) => {
          listener = fn;
          return () => {};
        },
        assetUrl: (asset: string) =>
          asset === "builtin:eva"
            ? "/Eva.vrm"
            : `/animations/${asset.slice(10)}.vrma`,
      },
    });
  }, snapshot);
  await page.goto("/?window=settings");
  const stats = page.getByRole("region", { name: "Your story so far" });
  await expect(stats).toBeVisible();
  await expect(stats.locator("dd strong")).toHaveText(["12", "1,248", "37"]);
  await expect(page.getByText("A space that grows with you")).toHaveCount(0);
  await expect(page.getByText("THE ROAD AHEAD")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/overview-statistics.png",
    fullPage: true,
  });
  for (const width of [1000, 760, 480]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await stats.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
  }
  const next = structuredClone(snapshot);
  next.settings.characters.push({
    ...next.settings.characters[0],
    id: "other",
    name: "Rei",
  });
  next.settings.activeCharacterId = "other";
  next.historyStats = { conversations: 2, messages: 5, images: 0 };
  await page.evaluate(
    (next) =>
      (
        window as unknown as { updateOverview: (s: typeof next) => void }
      ).updateOverview(next),
    next,
  );
  await expect(stats).toContainText("Rei’s saved history");
  await expect(stats.locator("dd strong")).toHaveText(["2", "5", "0"]);
  next.historyStats = undefined;
  await page.evaluate(
    (next) =>
      (
        window as unknown as { updateOverview: (s: typeof next) => void }
      ).updateOverview(next),
    next,
  );
  await expect(stats.locator("dd strong")).toHaveText(["—", "—", "—"]);
});

test("browser preview shows honest zero totals for its empty archive", async ({
  page,
}) => {
  await page.goto("/?window=settings");
  const stats = page.getByRole("region", { name: "Your story so far" });
  await expect(stats.locator("dd strong")).toHaveText(["0", "0", "0"]);
  await expect(stats).toContainText("All saved sessions · Desktop + Telegram");
});
