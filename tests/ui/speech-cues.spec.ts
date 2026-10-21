import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { defaultSettings } from "../../src/shared/schema";

test("hides cues in live and saved chat but keeps original text for replay and automatic speech", async ({
  page,
}) => {
  await page.addInitScript(
    ({ settings, audio }) => {
      settings.providers.tts.enabled = true;
      settings.voice.streaming = false;
      settings.voice.sentenceBuffering = false;
      const data = {
        settings,
        facts: [],
        messages: [
          {
            id: "user",
            role: "user",
            content: "Please use <whispering>",
            createdAt: new Date().toISOString(),
          },
          {
            id: "assistant",
            role: "assistant",
            content: "<whispering> Hello there.",
            createdAt: new Date().toISOString(),
          },
        ],
        sessionId: "fixture",
        busy: false,
        secretStorage: "local-file",
      };
      const fixture = {
        spoken: [] as string[],
        emit: (_event: any) => {},
        finish: () => {},
      };
      Object.assign(window, {
        cueFixture: fixture,
        eva: {
          snapshot: async () => structuredClone(data),
          onEvent: (listener: any) => {
            fixture.emit = listener;
            return () => {};
          },
          presence: async () => {},
          voiceActivity: async () => {},
          cancel: async () => {},
          pttStatus: async () => ({ testing: false }),
          assetUrl: () => "/AvatarSample_B.vrm",
          speak: async (text: string) => {
            fixture.spoken.push(text);
            return new Uint8Array(audio).buffer;
          },
          send: async () => {
            fixture.emit({ type: "delta", text: "<whis" });
            await new Promise<void>((resolve) => {
              fixture.finish = resolve;
            });
            const text = "<whispering> A quiet reply.";
            data.messages.push({
              id: "new",
              role: "assistant",
              content: text,
              createdAt: new Date().toISOString(),
            });
            fixture.emit({ type: "state", state: structuredClone(data) });
          },
        },
      });
    },
    {
      settings: defaultSettings,
      audio: [...readFileSync("tests/fixtures/speech.mp3")],
    },
  );
  await page.goto("/?window=companion");
  await expect(page.locator(".speech-bubble p")).toHaveText("Hello there.");
  await page
    .getByRole("button", { name: "Toggle conversation history" })
    .click();
  await expect(page.locator(".chat-message.user p")).toHaveText(
    "Please use <whispering>",
  );
  await expect(page.locator(".chat-message.assistant p")).toHaveText(
    "Hello there.",
  );
  await page.getByRole("button", { name: "Read aloud" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).cueFixture.spoken))
    .toEqual(["<whispering> Hello there."]);
  await page
    .getByRole("textbox", { name: "Message Eva" })
    .fill("Say something quietly");
  await page.getByRole("textbox", { name: "Message Eva" }).press("Enter");
  await expect(page.locator(".chat-message.assistant")).toHaveCount(2);
  await expect(page.locator(".chat-message.assistant p").last()).toHaveText("");
  await page.evaluate(() =>
    (window as any).cueFixture.emit({
      type: "delta",
      text: "pering> A quiet reply.",
    }),
  );
  await expect(page.locator(".chat-message.assistant p").last()).toHaveText(
    "A quiet reply.",
  );
  await page
    .getByRole("button", { name: "Toggle conversation history" })
    .click();
  await expect(page.locator(".speech-bubble p")).toHaveText("A quiet reply.");
  await page.evaluate(() => (window as any).cueFixture.finish());
  await expect
    .poll(() => page.evaluate(() => (window as any).cueFixture.spoken))
    .toEqual(["<whispering> Hello there.", "<whispering> A quiet reply."]);
  await expect(page.locator(".speech-bubble p")).toHaveText("A quiet reply.");
});
