import { test, expect } from "@playwright/test";
import { defaultSettings } from "../../src/shared/schema";

test("imported cards appear immediately, stay inactive and survive the next settings save", async ({
  page,
}) => {
  await page.addInitScript((settings) => {
    const snapshot = () =>
      structuredClone({
        settings,
        facts: [],
        messages: [],
        sessionId: "cards-test",
        busy: false,
        secretStorage: "session-only",
      });
    let listener: (event: unknown) => void = () => {};
    Object.assign(window, {
      eva: {
        snapshot: async () => snapshot(),
        onEvent: (fn: typeof listener) => {
          listener = fn;
          return () => {};
        },
        assetUrl: () => "/AvatarSample_B.vrm",
        importCharacter: async () => {
          settings.characters.push({
            ...structuredClone(settings.characters[0]),
            id: "imported",
            name: "Imported friend",
          });
          listener({ type: "state", state: snapshot() });
          return true;
        },
        saveSettings: async (next: typeof settings) => {
          settings = next;
          listener({ type: "state", state: snapshot() });
        },
      },
    });
  }, structuredClone(defaultSettings));
  await page.goto("/?window=settings");
  await page
    .getByRole("button", { name: "Character cards", exact: true })
    .click();
  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toHaveValue(defaultSettings.characters[0].name);
  await page
    .getByRole("button", { name: "Import character card", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Imported friend/ }),
  ).toBeVisible();
  await expect(name).toHaveValue(defaultSettings.characters[0].name);
  await name.fill("Eva updated");
  await expect(
    page.getByRole("button", { name: "Import character card", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Import character card", exact: true }),
  ).toBeEnabled();
  const saved = await page.evaluate(
    async () => (await window.eva!.snapshot()).settings,
  );
  expect(saved.activeCharacterId).toBe(defaultSettings.activeCharacterId);
  expect(saved.characters.map((c) => c.name)).toEqual([
    "Eva updated",
    "Imported friend",
  ]);
});

test("large desktop images are resized before IPC and keep the outgoing size bound", async ({
  page,
}) => {
  await page.goto("/?window=companion");
  const result = await page.evaluate(async () => {
    const module = "/src/images.ts";
    const { readImage } = await import(module);
    const canvas = document.createElement("canvas");
    canvas.width = 3200;
    canvas.height = 200;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#7852b7";
    context.fillRect(0, 0, 3200, 200);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), "image/png"),
    );
    const image = await readImage(
      new File([blob], "wide.png", { type: "image/png" }),
    );
    const decoded = new Image();
    decoded.src = image.dataUrl;
    await decoded.decode();
    return {
      width: decoded.width,
      height: decoded.height,
      name: image.name,
      prefix: image.dataUrl.slice(0, 23),
      length: image.dataUrl.length,
    };
  });
  expect(result.width).toBe(1600);
  expect(result.height).toBe(100);
  expect(result.name).toBe("wide.jpg");
  expect(result.prefix).toBe("data:image/jpeg;base64,");
  expect(result.length).toBeLessThan(2 * 1024 * 1024);
});

test("bundled neural VAD processes silence locally without CDN fetches", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      !request.url().startsWith("http://127.0.0.1:5173")
    )
      external.push(request.url());
  });
  await page.goto("/?window=settings");
  const result = await page.evaluate(async () => {
    const module = "/src/audio/neural-vad.ts";
    const { createNeuralVad } = await import(module);
    const vad = await createNeuralVad(48000);
    const values: number[] = [];
    try {
      await vad.process(
        new Float32Array(48000),
        (_frame: Float32Array, p: number) => values.push(p),
      );
    } finally {
      await vad.close();
    }
    return values;
  });
  expect(result.length).toBeGreaterThan(20);
  expect(
    result.every((v: number) => Number.isFinite(v) && v >= 0 && v < 0.5),
  ).toBe(true);
  expect(external).toEqual([]);
});

test("memory tools default to encrypted exports and expose deliberate cleanup", async ({
  page,
}) => {
  await page.goto("/?window=settings");
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(
    page.getByText("Inside her memory", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Archive passphrase (10+ characters)")
    .fill("my test passphrase");
  await expect(
    page.getByRole("button", { name: "Export", exact: true }),
  ).toBeEnabled();
  await page.getByText("Privacy & housekeeping", { exact: true }).click();
  await expect(
    page.getByLabel("History age in days (0 = keep all)"),
  ).toHaveValue("0");
});
