import { test, expect } from "@playwright/test";
import { defaultSettings } from "../../src/shared/schema";
import { initialBehavior } from "../../src/shared/autonomy";

test("activity loads ten entries, pages on demand, exposes diagnostics and exports independently", async ({
  page,
}) => {
  await page.addInitScript(
    ({ settings, state }) => {
      const entries = Array.from({ length: 25 }, (_, n) => ({
        id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
        characterId: "eva",
        at: new Date(n).toISOString(),
        kind: "failed",
        detail: `Fixture event ${n}`,
        requests: 1,
        diagnostic:
          n === 24
            ? {
                attemptId: "fixture-attempt",
                stage: "provider",
                elapsedMs: 1234,
                httpStatus: 400,
              }
            : undefined,
      })).reverse();
      const fixture = {
        queries: [] as unknown[],
        exportMode: "success",
        exports: 0,
        failPage: false,
      };
      Object.assign(window, {
        activityFixture: fixture,
        eva: {
          snapshot: async () => ({
            settings,
            facts: [],
            messages: [],
            sessionId: "test",
            busy: false,
            secretStorage: "local-file",
            autonomy: {
              state,
              tasks: [],
              gate: "Ready",
              characterId: "eva",
              activity: entries.slice(0, 10),
              activityTotal: entries.length,
            },
          }),
          onEvent: () => () => {},
          presence: async () => {},
          assetUrl: () => "/AvatarSample_B.vrm",
          listActivity: async (query: { before: string }) => {
            fixture.queries.push(query);
            if (fixture.failPage) throw new Error("Fixture pagination failed");
            const start = entries.findIndex((e) => e.id === query.before) + 1;
            return {
              entries: entries.slice(start, start + 10),
              total: entries.length,
              hasMore: start + 10 < entries.length,
            };
          },
          exportActivity: async () => {
            fixture.exports++;
            if (fixture.exportMode === "failure")
              throw new Error("Fixture export failed");
            return fixture.exportMode !== "cancel";
          },
        },
      });
    },
    { settings: defaultSettings, state: initialBehavior(Date.now()) },
  );
  await page.goto("/?window=settings");
  await page
    .getByRole("button", { name: "Inner life", exact: true })
    .click();
  const log = page.getByRole("region", { name: "Activity log", exact: true });
  await expect(log.getByRole("article")).toHaveCount(10);
  expect(
    await page.evaluate(() => (window as any).activityFixture.queries.length),
  ).toBe(0);
  await log.getByText(/Diagnostic details/).click();
  await expect(log.locator("pre")).toContainText('"httpStatus": 400');
  await log.getByRole("button", { name: "Older 10" }).click();
  await expect(log.getByRole("article").first()).toContainText(
    "Fixture event 14",
  );
  await expect(log.getByRole("article")).toHaveCount(10);
  await page.evaluate(() => {
    (window as any).activityFixture.failPage = true;
  });
  await log.getByRole("button", { name: "Older 10" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Fixture pagination failed",
  );
  await expect(log.getByRole("article").first()).toContainText(
    "Fixture event 14",
  );
  await page.evaluate(() => {
    (window as any).activityFixture.failPage = false;
  });
  await log.getByRole("button", { name: "Older 10" }).click();
  await expect(log.getByRole("article")).toHaveCount(5);
  await expect(log.getByRole("button", { name: "Older 10" })).toHaveCount(0);
  await log.getByRole("button", { name: "Export all logs" }).click();
  await expect(log.getByRole("status")).toHaveText("Activity logs exported.");
  await page.evaluate(() => {
    (window as any).activityFixture.exportMode = "cancel";
  });
  await log.getByRole("button", { name: "Export all logs" }).click();
  await expect(log.getByRole("status")).toContainText("Export cancelled");
  await page.evaluate(() => {
    (window as any).activityFixture.exportMode = "failure";
  });
  await log.getByRole("button", { name: "Export all logs" }).click();
  await expect(page.getByRole("alert")).toContainText("Fixture export failed");
  await log.getByRole("button", { name: "Latest 10" }).click();
  await expect(log.getByRole("article")).toHaveCount(10);
  await expect(log.getByRole("article").first()).toContainText(
    "Fixture event 24",
  );
});

test("exposes opt-in autonomy, quiet hours, state controls and validated settings", async ({
  page,
}) => {
  await page.goto("/?window=settings");
  await page
    .getByRole("button", { name: "Inner life", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Enable autonomy", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("heading", { name: "Scheduled reminders", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Activity log", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Enable autonomy", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Allow conversation openers", exact: true })
    .check();
  await page.getByLabel("Time zone (IANA)").fill("Europe/Moscow");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".success-notice")).toContainText("Settings saved");
  await page
    .getByRole("button", { name: "Her voice", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Inner life", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Enable autonomy", exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel("Time zone (IANA)")).toHaveValue(
    "Europe/Moscow",
  );
  await page.getByLabel("Time zone (IANA)").fill("Not/AZone");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText("IANA");
});

test("manual task form is explicit about exact time and desktop requirements", async ({
  page,
}) => {
  await page.goto("/?window=settings");
  await page
    .getByRole("button", { name: "Inner life", exact: true })
    .click();
  await page.getByLabel("Reminder title", { exact: true }).fill("Tea break");
  await page
    .getByLabel("What should she remind you about?", { exact: true })
    .fill("Make tea");
  await page
    .getByLabel("Exact reminder time (ISO with offset)", { exact: true })
    .fill("2026-09-13T18:30:00+03:00");
  await page
    .getByRole("button", { name: "Create authorized reminder" })
    .click();
  await expect(page.getByRole("alert")).toContainText("browser preview");
  await expect(page.getByRole("slider", { name: "Set mood" })).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Mood expressions and gestures" }),
  ).toBeChecked();
});
