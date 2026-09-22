import { test, expect } from "@playwright/test";

test("renders the supplied VRM, edits settings and manages facts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon"))
      errors.push(message.text());
  });
  await page.goto("/?window=settings");
  await expect(
    page.getByRole("heading", { name: "Hello, this is her world." }),
  ).toBeVisible();
  await expect(page.locator(".avatar-renderer canvas")).toBeVisible();
  await expect(page.locator(".avatar-notice")).toHaveCount(0, {
    timeout: 60000,
  });
  await page.screenshot({
    path: "test-results/settings-overview.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Character cards", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Evie");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Settings saved");
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await page
    .getByRole("textbox", { name: "What should she remember?" })
    .fill("I love Minecraft.");
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  await expect(page.locator(".memory-item")).toContainText("I love Minecraft.");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "What should she remember?" })
    .fill("I love cherry wood houses.");
  await page.getByRole("button", { name: "Update memory" }).click();
  await expect(page.locator(".memory-item")).toContainText("cherry wood");
  await page
    .getByRole("button", { name: "Delete memory: I love cherry wood houses." })
    .click();
  await expect(page.locator(".memory-item")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Avatar studio", exact: true })
    .click();
  for (const name of [
    "idle_loop",
    "modelPose",
    "greeting",
    "peaceSign",
    "dance",
    "showFullBody",
    "shoot",
    "spin",
    "squat",
  ]) {
    await page
      .getByRole("combobox", { name: "Animation", exact: true })
      .selectOption(name);
    await expect(page.locator(".avatar-renderer")).toHaveAttribute(
      "data-animation",
      name,
      { timeout: 15000 },
    );
  }
  await expect(page.locator(".avatar-notice")).toHaveCount(0, {
    timeout: 60000,
  });
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: "Consciousness" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Enable autonomy" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("companion has a transparent stage and clearly reports browser-only limitations", async ({
  page,
}) => {
  await page.goto("/?window=companion");
  await expect(
    page.getByRole("textbox", { name: "Message Eva" }),
  ).toBeVisible();
  expect(
    await page
      .locator("body")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)");
  await page.getByRole("textbox", { name: "Message Eva" }).fill("Hello Eva");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("alert")).toContainText("browser preview");
  await expect(page.locator(".avatar-notice")).toHaveCount(0, {
    timeout: 60000,
  });
  await page.screenshot({
    path: "test-results/companion.png",
    omitBackground: true,
  });
});
