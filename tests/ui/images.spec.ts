import { test, expect } from "@playwright/test";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const file = {
  name: "pixel.png",
  mimeType: "image/png",
  buffer: Buffer.from(png, "base64"),
};

test("previews/removes attachments, sends image-only turns and displays history", async ({
  page,
}) => {
  await page.goto("/?window=companion");
  await expect(
    page.getByRole("button", { name: "Attach images" }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const modulePath = "/src/bridge.ts";
    const { bridge } = await import(modulePath);
    const state = await bridge.snapshot();
    bridge.snapshot = async () => structuredClone(state);
    bridge.send = async (text: string, images: unknown[]) => {
      state.messages.push({
        id: "image-turn",
        characterId: "eva",
        sessionId: state.sessionId,
        role: "user",
        content: text,
        images,
        createdAt: new Date().toISOString(),
      });
    };
  });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach images" }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByAltText("Attached: pixel.png")).toBeVisible();
  await page.getByRole("button", { name: "Remove pixel.png" }).click();
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeDisabled();
  await page.getByLabel("Choose images").setInputFiles(file);
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByAltText("Attached: pixel.png")).toHaveCount(0);
  await expect(
    page.locator(".speech-bubble").getByAltText("pixel.png"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Toggle conversation history" })
    .click();
  await expect(
    page.locator(".chat-message.user").getByAltText("pixel.png"),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("rejects unsupported/oversized/too many images without discarding the existing draft", async ({
  page,
}) => {
  await page.goto("/?window=companion");
  const input = page.getByLabel("Choose images");
  await input.setInputFiles(file);
  await expect(page.getByAltText("Attached: pixel.png")).toBeVisible();
  await input.setInputFiles({
    name: "bad.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await expect(page.getByRole("alert")).toContainText("PNG, JPEG, WebP or GIF");
  await input.setInputFiles({
    ...file,
    name: "large.png",
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
  });
  await expect(page.getByRole("alert")).toContainText("2 MB");
  await input.setInputFiles([file, file, file, file]);
  await expect(page.getByRole("alert")).toContainText("up to 4 images");
  await expect(page.getByAltText("Attached: pixel.png")).toHaveCount(1);
  // Header-shaped but corrupt payloads are rejected by browser decoding too.
  await input.setInputFiles({
    ...file,
    name: "corrupt.png",
    buffer: Buffer.from("89504e470d0a1a0a", "hex"),
  });
  await expect(page.getByRole("alert")).toContainText("could not be decoded");
});

test("pastes clipboard images and clears attachments on a new conversation", async ({
  page,
}) => {
  await page.goto("/?window=companion");
  await page.getByRole("textbox", { name: "Message Eva" }).waitFor();
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    document
      .querySelector(".composer input[aria-label='Message Eva']")!
      .dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboard,
        }),
      );
  }, png);
  await expect(page.getByAltText("Attached: pasted.png")).toBeVisible();
  // Preview sessions reuse their ID, so emulate the desktop's new-session snapshot.
  await page.evaluate(async () => {
    const modulePath = "/src/bridge.ts";
    const { bridge } = await import(modulePath);
    const state = await bridge.snapshot();
    state.settings.activeCharacterId = "different-character";
    state.settings.characters.push({
      ...state.settings.characters[0],
      id: "different-character",
    });
    await bridge.saveSettings(state.settings, {});
  });
  await expect(page.getByAltText("Attached: pasted.png")).toHaveCount(0);
});
