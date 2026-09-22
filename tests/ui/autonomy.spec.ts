import { test, expect } from "@playwright/test";

test("exposes opt-in autonomy, quiet hours, state controls and validated settings", async ({
  page,
}) => {
  await page.goto("/?window=settings");
  await page
    .getByRole("button", { name: "Consciousness", exact: true })
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
    .getByRole("button", { name: "Voice & audio", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Consciousness", exact: true })
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
    .getByRole("button", { name: "Consciousness", exact: true })
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
