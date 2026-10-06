import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page, mode = "hold") {
  await page.goto("/?window=companion");
  await page.getByRole("textbox", { name: "Message Eva" }).waitFor();
  await page.evaluate(async (mode) => {
    const bp = "/src/bridge.ts",
      mp = "/src/audio/microphone.ts";
    const { bridge } = await import(bp),
      { MicrophoneCapture } = await import(mp);
    const w = window as any;
    w.ptt = {
      opens: 0,
      finishes: 0,
      closes: 0,
      transcribes: 0,
      sends: [],
      cancels: 0,
      holdOpen: false,
      holdAsr: false,
      silent: false,
      voice: null,
      indicators: [],
    };
    MicrophoneCapture.prototype.open = async function () {
      w.ptt.opens++;
      w.ptt.voice = this.voice;
      w.ptt.mic = this;
      if (w.ptt.holdOpen)
        await new Promise<void>((resolve) => {
          w.ptt.allowOpen = resolve;
        });
      if (this.closed) return;
      this.ready = true;
      this.callbacks.start();
    };
    MicrophoneCapture.prototype.finishAndSend = async function () {
      if (this.closed) return;
      w.ptt.finishes++;
      if (this.ready && !w.ptt.silent)
        this.callbacks.utterance(new ArrayBuffer(100));
      this.close();
    };
    MicrophoneCapture.prototype.close = function () {
      if (this.closed) return;
      this.closed = true;
      w.ptt.closes++;
      this.callbacks.ended?.();
    };
    bridge.transcribe = async () => {
      w.ptt.transcribes++;
      if (w.ptt.holdAsr)
        await new Promise<void>((r) => {
          w.ptt.allowAsr = r;
        });
      return "Hello from my key";
    };
    bridge.send = async (text: string) => {
      w.ptt.sends.push(text);
    };
    bridge.cancel = async () => {
      w.ptt.cancels++;
    };
    bridge.voiceActivity = async (phase: string) => {
      w.ptt.indicators.push(phase);
    };
    const s = (await bridge.snapshot()).settings;
    s.providers.asr.enabled = true;
    s.voice.autoSpeak = false;
    s.voice.vadEnabled = true; // PTT must override it without losing the saved preference.
    s.voice.ptt = {
      ...s.voice.ptt,
      enabled: true,
      key: "ShiftRight",
      scope: "app",
      mode,
    };
    await bridge.saveSettings(s, {});
  }, mode);
  await page.locator(".phase-label").click();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
}
const stats = (page: Page) =>
  page.evaluate(() => {
    const { mic, allowOpen, allowAsr, ...rest } = (window as any).ptt;
    return rest;
  });

test("Right Shift records once, ignores repeats/left shift and sends once on release", async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.press("ShiftLeft");
  expect((await stats(page)).opens).toBe(0);
  await page.keyboard.down("ShiftRight");
  await expect(page.locator(".phase-label")).toHaveText("listening…");
  await page.keyboard.down("ShiftRight");
  expect((await stats(page)).voice.vadEnabled).toBe(false);
  await page.keyboard.up("ShiftRight");
  await expect
    .poll(async () => (await stats(page)).sends)
    .toEqual(["Hello from my key"]);
  expect(await stats(page)).toMatchObject({
    opens: 1,
    finishes: 1,
    transcribes: 1,
    closes: 1,
  });
});

test("toggle needs a second press, while blur and Escape discard without ASR", async ({
  page,
}) => {
  await setup(page, "toggle");
  await page.keyboard.press("ShiftRight");
  await expect(page.locator(".phase-label")).toHaveText("listening…");
  expect((await stats(page)).transcribes).toBe(0);
  await page.keyboard.press("ShiftRight");
  await expect.poll(async () => (await stats(page)).transcribes).toBe(1);
  await page.keyboard.press("ShiftRight");
  await expect(page.locator(".phase-label")).toHaveText("listening…");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator(".phase-label")).toHaveText("here with you");
  expect((await stats(page)).transcribes).toBe(1);
  await page.keyboard.press("ShiftRight");
  await page.keyboard.press("Escape");
  expect((await stats(page)).transcribes).toBe(1);
});

test("typing, fast release during startup and stale ASR cannot send a message", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("textbox", { name: "Message Eva" }).focus();
  await page.keyboard.press("ShiftRight");
  expect((await stats(page)).opens).toBe(0);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    (window as any).ptt.holdOpen = true;
  });
  await page.keyboard.down("ShiftRight");
  await expect.poll(async () => (await stats(page)).opens).toBe(1);
  await page.keyboard.up("ShiftRight");
  await page.evaluate(() => {
    (window as any).ptt.allowOpen();
    (window as any).ptt.holdOpen = false;
  });
  expect((await stats(page)).transcribes).toBe(0);
  await page.evaluate(() => {
    (window as any).ptt.holdAsr = true;
  });
  await page.keyboard.down("ShiftRight");
  await expect.poll(async () => (await stats(page)).opens).toBe(2);
  await page.keyboard.up("ShiftRight");
  await expect.poll(async () => (await stats(page)).transcribes).toBe(1);
  await page.keyboard.press("ShiftRight"); // Busy ASR is rejected, not replaced.
  expect((await stats(page)).opens).toBe(2);
  await page.evaluate(async () => {
    const bp = "/src/bridge.ts";
    const { bridge } = await import(bp);
    const s = (await bridge.snapshot()).settings;
    s.activeCharacterId = "other";
    s.characters.push({ ...s.characters[0], id: "other" });
    await bridge.saveSettings(s, {});
    (window as any).ptt.allowAsr();
  });
  expect((await stats(page)).sends).toEqual([]);
});

test("PTT settings capture right shift and chords, save, clear, and fit narrow layouts", async ({
  page,
}) => {
  await page.goto("/?window=settings");
  await page
    .getByRole("button", { name: "Voice & audio", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Set press-to-talk key" }),
  ).toHaveText("Right Shift");
  await page.getByRole("button", { name: "Set press-to-talk key" }).click();
  await page.keyboard.press("Control+KeyV");
  await expect(
    page.getByRole("button", { name: "Set press-to-talk key" }),
  ).toHaveText("Ctrl+V");
  await page.getByRole("button", { name: "Set press-to-talk key" }).click();
  await page.keyboard.press("ShiftRight");
  await expect(
    page.getByRole("button", { name: "Set press-to-talk key" }),
  ).toHaveText("Right Shift");
  await page
    .getByRole("checkbox", { name: "Keyboard voice control", exact: true })
    .check();
  await page
    .getByRole("combobox", { name: "Key behavior" })
    .selectOption("toggle");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".success-notice")).toContainText("Settings saved");
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await page
    .getByRole("button", { name: "Voice & audio", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Keyboard voice control", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("combobox", { name: "Key behavior" }),
  ).toHaveValue("toggle");
  await page.setViewportSize({ width: 960, height: 850 });
  await page.screenshot({
    path: "test-results/settings-ptt.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Clear press-to-talk key" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Keyboard voice control", exact: true }),
  ).not.toBeChecked();
});

test("losing focus without a keyboard recording does not cancel ordinary chat", async ({
  page,
}) => {
  await setup(page);
  const before = (await stats(page)).cancels;
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  expect((await stats(page)).cancels).toBe(before);
  await page.evaluate(async () => {
    const bp = "/src/bridge.ts";
    const { bridge } = await import(bp);
    const s = (await bridge.snapshot()).settings;
    s.voice.ptt.enabled = false;
    await bridge.saveSettings(s, {});
  });
  const disabled = (await stats(page)).cancels;
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  expect((await stats(page)).cancels).toBe(disabled);
});

test("sending an image while recording cancels PTT even when saved VAD is enabled", async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.down("ShiftRight");
  await expect(page.locator(".phase-label")).toHaveText("listening…");
  await page.locator('input[type="file"]').setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.keyboard.up("ShiftRight");
  expect(await stats(page)).toMatchObject({
    closes: 1,
    transcribes: 0,
    sends: [""],
  });
});
