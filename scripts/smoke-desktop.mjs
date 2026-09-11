import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

// An isolated, disposable profile and a local provider exercise real Electron IPC/HTTP.
const profile = await mkdtemp(path.join(tmpdir(), "eva-desktop-smoke-"));
const requests = [];
const imageAttachment = {
  name: "pixel.png",
  dataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
};
const speechFixture = await readFile(path.resolve("tests/fixtures/speech.mp3"));
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  requests.push({
    url: req.url,
    body,
    authorization: req.headers.authorization,
  });
  if (req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      '{"data":[{"id":"test-chat"},{"id":"test-asr"},{"id":"test-tts"}]}',
    );
  } else if (req.url === "/v1/embeddings") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        data: JSON.parse(body).input.map((_, index) => ({
          index,
          embedding: [1, 0, 0],
        })),
      }),
    );
  } else if (req.url === "/v1/chat/completions") {
    const data = JSON.parse(body);
    if (data.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const sentenceTest =
        data.messages.at(-1).content === "Test sentence queue";
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: sentenceTest ? "First sentence. " : "Hello from the test provider." } }] })}\n\n`,
      );
      if (sentenceTest)
        await new Promise((resolve) => setTimeout(resolve, 1000));
      if (sentenceTest)
        res.write(
          'data: {"choices":[{"delta":{"content":"Second sentence."}}]}\n\n',
        );
      res.end("data: [DONE]\n\n");
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"choices":[{"message":{"content":"OK"}}]}');
    }
  } else if (req.url === "/v1/audio/transcriptions") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"text":"I like Minecraft."}');
  } else if (req.url === "/v1/audio/speech") {
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.write(speechFixture.subarray(0, 3000));
    await new Promise((resolve) => setTimeout(resolve, 200));
    res.end(speechFixture.subarray(3000));
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
let desktop;
const launch = () =>
  electron.launch({
    args: [
      ".",
      ...(process.env.EVA_TEST_HEADLESS ? ["--ozone-platform=headless"] : []),
      "--enable-unsafe-swiftshader",
      "--password-store=basic",
    ],
    env: { ...process.env, EVA_DEV_URL: "", EVA_TEST_DATA_DIR: profile },
    timeout: 30000,
  });
try {
  desktop = await launch();
  desktop.process().stderr.on("data", (data) => process.stderr.write(data));
  await desktop.firstWindow();
  // First startup also opens settings; window creation order is not guaranteed.
  await expect
    .poll(() =>
      desktop
        .windows()
        .some((window) => window.url().includes("window=companion")),
    )
    .toBe(true);
  const win = desktop
    .windows()
    .find((window) => window.url().includes("window=companion"));
  await win.waitForFunction(() => !!window.eva);
  await win
    .locator('.avatar-renderer[data-animation="idle_loop"]')
    .waitFor({ timeout: 60000 });
  const initial = await win.evaluate(() => window.eva.snapshot());
  assert.equal(initial.settings.activeCharacterId, "eva");
  assert.equal(await win.evaluate(() => typeof window.require), "undefined");
  await win.evaluate(
    async ({ baseUrl, settings }) => {
      settings.voice.autoSpeak = false;
      for (const kind of ["llm", "asr", "tts", "embedding"]) {
        settings.providers[kind].baseUrl = baseUrl;
        settings.providers[kind].enabled = true;
      }
      await window.eva.saveSettings(settings, { llm: "local-test-key" });
      await window.eva.saveFact({ text: "The user likes Minecraft." });
    },
    { baseUrl, settings: initial.settings },
  );
  await win.getByLabel("Choose images").setInputFiles({
    name: imageAttachment.name,
    mimeType: "image/png",
    buffer: Buffer.from(imageAttachment.dataUrl.split(",")[1], "base64"),
  });
  await win.getByAltText("Attached: pixel.png").waitFor();
  await win.getByRole("textbox", { name: "Message Eva" }).fill("Hello Eva");
  await win.getByRole("button", { name: "Send message" }).click();
  await win.waitForFunction(
    async () =>
      (await window.eva.snapshot()).messages.at(-1)?.role === "assistant",
  );
  assert.deepEqual(JSON.parse(requests[0].body).messages.at(-1).content, [
    { type: "text", text: "Hello Eva" },
    { type: "image_url", image_url: { url: imageAttachment.dataUrl } },
  ]);
  const after = await win.evaluate(() => window.eva.snapshot());
  assert.equal(after.messages.at(-1).content, "Hello from the test provider.");
  assert.equal(after.facts[0].text, "The user likes Minecraft.");
  assert.equal(JSON.stringify(after).includes("local-test-key"), false);
  assert.equal(requests[0].authorization, "Bearer local-test-key");
  assert.ok(
    JSON.parse(requests[0].body).messages[0].content.includes("Minecraft"),
  );
  assert.equal(
    await win.evaluate(() =>
      window.eva.transcribe(new Uint8Array([1, 2, 3]).buffer, "audio/webm"),
    ),
    "I like Minecraft.",
  );
  assert.equal(
    await win.evaluate(
      async () => (await window.eva.speak("Hello")).byteLength,
    ),
    speechFixture.byteLength,
  );
  for (const kind of ["llm", "asr", "tts"])
    assert.equal(
      (await win.evaluate((kind) => window.eva.listModels(kind), kind)).length,
      3,
    );
  assert.equal(
    (await win.evaluate(() => window.eva.reindexMemory())).indexed,
    2,
  );
  const assetBytes = await win.evaluate(
    async () =>
      (await (await fetch(window.eva.assetUrl("builtin:eva"))).arrayBuffer())
        .byteLength,
  );
  assert.ok(assetBytes > 70000000);
  const blocked = await win.evaluate(
    async () => (await fetch("eva://assets/../../etc/passwd")).status,
  );
  assert.equal(blocked, 404);
  const archivePath = path.join(profile, "export.json");
  await desktop.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, archivePath);
  assert.equal(await win.evaluate(() => window.eva.exportMemory()), true);
  const archiveText = await readFile(archivePath, "utf8");
  assert.equal(archiveText.includes("local-test-key"), false);
  assert.equal(JSON.parse(archiveText).messages.length, 2);
  assert.deepEqual(JSON.parse(archiveText).messages[0].images, [
    imageAttachment,
  ]);
  await desktop.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, archivePath);
  await win.evaluate(() => window.eva.importMemory());
  assert.equal(
    (await win.evaluate(() => window.eva.snapshot())).facts.length,
    1,
  );
  await desktop.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({
      response: 0,
      checkboxChecked: false,
    });
  });
  await win.evaluate(() => window.eva.clearHistory());
  assert.equal(
    (await win.evaluate(() => window.eva.snapshot())).messages.length,
    2,
  );
  await win.evaluate(() => window.eva.newSession());
  assert.equal(
    (await win.evaluate(() => window.eva.snapshot())).messages.length,
    0,
  );
  await desktop.close();
  desktop = null;
  const persisted = JSON.parse(
    await readFile(path.join(profile, "companion.json"), "utf8"),
  );
  assert.equal(persisted.messages.length, 2);
  assert.deepEqual(persisted.messages[0].images, [imageAttachment]);
  desktop = await launch();
  const reopened = await desktop.firstWindow();
  await reopened.waitForFunction(() => !!window.eva);
  const state = await reopened.evaluate(() => window.eva.snapshot());
  assert.equal(state.facts[0].text, "The user likes Minecraft.");
  assert.equal(state.messages.length, 0);
  assert.equal(state.settings.providers.llm.hasKey, true);
  await reopened.evaluate(async () => {
    const s = (await window.eva.snapshot()).settings;
    s.voice.autoSpeak = true;
    s.memory.semanticEnabled = true;
    await window.eva.saveSettings(s, {});
  });
  const previousSpeechCount = requests.filter(
    (r) => r.url === "/v1/audio/speech",
  ).length;
  await reopened
    .getByRole("textbox", { name: "Message Eva" })
    .fill("Test sentence queue");
  await reopened.getByRole("button", { name: "Send message" }).click();
  await reopened.waitForFunction(
    () =>
      document.querySelector(".phase-label")?.textContent === "here with you" &&
      document
        .querySelector(".speech-bubble p")
        ?.textContent?.includes("Second sentence"),
    null,
    { timeout: 15000 },
  );
  const spoken = requests
    .filter((r) => r.url === "/v1/audio/speech")
    .slice(previousSpeechCount)
    .map((r) => JSON.parse(r.body).input);
  assert.deepEqual(spoken, ["First sentence.", "Second sentence."]);
  assert.equal(await reopened.getByRole("alert").count(), 0);
  const chatRequest = requests
    .filter((r) => r.url === "/v1/chat/completions")
    .at(-1);
  assert.equal(chatRequest.authorization, "Bearer local-test-key");
  assert.ok(
    JSON.parse(chatRequest.body).messages[0].content.includes("Minecraft"),
  );
  // Feed a synthetic microphone into the real renderer to exercise hands-free barge-in.
  await reopened.evaluate(async () => {
    const s = (await window.eva.snapshot()).settings;
    s.voice.vadEnabled = true;
    s.voice.vadSilenceMs = 300;
    s.voice.vadMinSpeechMs = 150;
    await window.eva.saveSettings(s, {});
    const context = new AudioContext();
    await context.resume();
    const oscillator = context.createOscillator(),
      gain = context.createGain(),
      destination = context.createMediaStreamDestination();
    gain.gain.value = 0;
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();
    navigator.mediaDevices.getUserMedia = async () => destination.stream;
    window.testMicrophone = { context, oscillator, gain };
  });
  await reopened
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await reopened
    .getByRole("button", { name: "Stop hands-free listening" })
    .waitFor();
  const beforeInterrupt = requests.filter(
    (r) => r.url === "/v1/audio/speech",
  ).length;
  await reopened
    .getByRole("textbox", { name: "Message Eva" })
    .fill("Test sentence queue");
  await reopened.getByRole("button", { name: "Send message" }).click();
  await reopened.waitForFunction(
    () => document.querySelector(".phase-label")?.textContent === "speaking…",
  );
  await reopened.evaluate(() => {
    const m = window.testMicrophone;
    m.gain.gain.setValueAtTime(0.15, m.context.currentTime);
    m.gain.gain.setValueAtTime(0, m.context.currentTime + 0.5);
  });
  await reopened.waitForFunction(
    () =>
      document.querySelector(".speech-bubble p")?.textContent ===
        "Hello from the test provider." &&
      document.querySelector(".phase-label")?.textContent === "listening…",
    null,
    { timeout: 15000 },
  );
  const afterInterrupt = requests
    .filter((r) => r.url === "/v1/audio/speech")
    .slice(beforeInterrupt)
    .map((r) => JSON.parse(r.body).input);
  assert.ok(!afterInterrupt.includes("Second sentence."));
  assert.ok(afterInterrupt.includes("Hello from the test provider."));
  await reopened
    .getByRole("button", { name: "Stop hands-free listening" })
    .click();
  await reopened.evaluate(async () => {
    window.testMicrophone.oscillator.stop();
    await window.testMicrophone.context.close();
  });
  await desktop.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  });
  await reopened.evaluate(() => window.eva.clearHistory());
  const cleared = JSON.parse(
    await readFile(path.join(profile, "companion.json"), "utf8"),
  );
  assert.equal(cleared.messages.length, 0);
  assert.equal(cleared.facts.length, 1);
  console.log(
    "Desktop smoke passed: image attachment UI/IPC/HTTP/persistence, key persistence without a keyring, models, semantic recall, sentence ordering, synthetic-microphone barge-in, streamed audio, VRM, archive round-trip, deletion and restart persistence.",
  );
} finally {
  if (desktop) await desktop.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
