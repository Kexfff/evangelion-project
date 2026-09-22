import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

// An isolated, disposable profile and a local provider exercise real Electron IPC/HTTP.
const profile = await mkdtemp(path.join(tmpdir(), "eva-desktop-smoke-"));
const requests = [];
let lineReplyFinished = true;
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
    lineReplyFinished,
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
      if (data.messages.at(-1).content === "Test line queue") {
        lineReplyFinished = false;
        const delta = (content) =>
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
          );
        delta("Yes. Sure! ");
        delta("Together on one line.\r");
        delta("\n\nFinal line. Short sentences!");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        lineReplyFinished = true;
        res.end("data: [DONE]\n\n");
        return;
      }
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
  for (const mode of ["line", "response"]) {
    await reopened.evaluate(async (mode) => {
      const s = (await window.eva.snapshot()).settings;
      s.voice.sentenceBuffering = mode !== "response";
      s.voice.speechChunking = "line";
      await window.eva.saveSettings(s, {});
    }, mode);
    const before = requests.filter((r) => r.url === "/v1/audio/speech").length;
    await reopened
      .getByRole("textbox", { name: "Message Eva" })
      .fill("Test line queue");
    await reopened.getByRole("button", { name: "Send message" }).click();
    // Both iterations have identical reply text: wait for this turn's requests,
    // not an idle UI still displaying the previous turn during cancellation.
    await expect
      .poll(
        () =>
          requests.filter((r) => r.url === "/v1/audio/speech").length - before,
        { timeout: 15000 },
      )
      .toBe(mode === "line" ? 2 : 1);
    await reopened.waitForFunction(
      () =>
        document.querySelector(".phase-label")?.textContent ===
          "here with you" &&
        document
          .querySelector(".speech-bubble p")
          ?.textContent?.includes("Final line"),
      null,
      { timeout: 15000 },
    );
    const speech = requests
      .filter((r) => r.url === "/v1/audio/speech")
      .slice(before);
    assert.deepEqual(
      speech.map((r) => JSON.parse(r.body).input),
      mode === "line"
        ? ["Yes. Sure! Together on one line.", "Final line. Short sentences!"]
        : [
            "Yes. Sure! Together on one line.\r\n\nFinal line. Short sentences!",
          ],
    );
    assert.equal(speech[0].lineReplyFinished, mode === "response");
    assert.equal(await reopened.getByRole("alert").count(), 0);
  }
  // Feed a synthetic microphone into the real renderer to exercise hands-free barge-in.
  await reopened.evaluate(async () => {
    const s = (await window.eva.snapshot()).settings;
    s.voice.sentenceBuffering = true;
    s.voice.speechChunking = "sentence";
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
  // Authorize one reminder and cancel another, then restart the real desktop.
  // Exercise real plugin settings IPC and vault persistence without contacting Telegram.
  await reopened.evaluate(() => window.eva.openSettings());
  await expect
    .poll(() =>
      desktop.windows().some((w) => w.url().includes("window=settings")),
    )
    .toBe(true);
  const pluginWindow = desktop
    .windows()
    .find((w) => w.url().includes("window=settings"));
  await pluginWindow
    .getByRole("button", { name: "Plugins & MCP", exact: true })
    .click();
  await pluginWindow
    .getByRole("button", { name: "Install bundled Telegram" })
    .click();
  await pluginWindow
    .getByLabel("Bot token", { exact: true })
    .fill("123456:abcdefghijklmnopqrstuvwx0123456789");
  await pluginWindow
    .getByRole("checkbox", {
      name: "Chat — shared character history and memory (required)",
    })
    .check();
  await pluginWindow
    .getByRole("button", { name: "Save Telegram configuration" })
    .click();
  await expect(pluginWindow.getByRole("status")).toContainText(
    "Telegram configuration saved",
  );
  const pluginSaved = (await reopened.evaluate(() => window.eva.snapshot()))
    .plugins;
  assert.equal(pluginSaved.hasToken, true);
  assert.equal(pluginSaved.config.enabled, false);
  assert.ok(!JSON.stringify(pluginSaved).includes("abcdefghijklmnopqrstuvwx"));
  assert.ok(
    !(await readFile(path.join(profile, "credentials.json"), "utf8")).includes(
      "abcdefghijklmnopqrstuvwx",
    ),
  );
  await pluginWindow.close();
  await reopened.evaluate(async () => {
    const s = (await window.eva.snapshot()).settings;
    s.voice.vadEnabled = false;
    s.autonomy.enabled = true;
    s.autonomy.proactive = false;
    s.autonomy.quietEnabled = false;
    s.autonomy.cooldownMinutes = 1;
    await window.eva.saveSettings(s, {});
    const dueAt = new Date(Date.now() + 2000).toISOString();
    await window.eva.createTask({
      title: "Restart reminder",
      intent: "Remember the desktop test",
      dueAt,
      timeZone: "UTC",
    });
    await window.eva.createTask({
      title: "Cancelled reminder",
      intent: "Must not fire",
      dueAt,
      timeZone: "UTC",
    });
    const task = (await window.eva.snapshot()).autonomy.tasks.find(
      (t) => t.title === "Cancelled reminder",
    );
    await window.eva.taskAction(task.id, "cancel");
  });
  await desktop.close();
  desktop = await launch();
  const scheduledWindow = await desktop.firstWindow();
  await scheduledWindow.waitForFunction(() => !!window.eva);
  const persistedPlugin = (
    await scheduledWindow.evaluate(() => window.eva.snapshot())
  ).plugins;
  assert.equal(persistedPlugin.hasToken, true);
  assert.equal(persistedPlugin.installedVersion, "1.0.0");
  assert.deepEqual(persistedPlugin.config.grants, ["channel:chat"]);
  // Draft text is a blocking user interaction, even with an overdue task.
  await scheduledWindow
    .getByRole("textbox", { name: "Message Eva" })
    .fill("I am typing");
  await expect
    .poll(
      () =>
        scheduledWindow.evaluate(async () =>
          (await window.eva.snapshot()).autonomy.gate.includes("busy"),
        ),
      { timeout: 15000 },
    )
    .toBe(true);
  assert.equal(
    (
      await scheduledWindow.evaluate(() => window.eva.snapshot())
    ).autonomy.tasks.find((t) => t.title === "Restart reminder").status,
    "pending",
  );
  await scheduledWindow.getByRole("textbox", { name: "Message Eva" }).fill("");
  await expect
    .poll(
      () =>
        scheduledWindow.evaluate(async () =>
          (await window.eva.snapshot()).autonomy.tasks.some(
            (t) => t.title === "Restart reminder" && t.status === "done",
          ),
        ),
      { timeout: 40000 },
    )
    .toBe(true);
  await scheduledWindow.waitForFunction(
    () =>
      document.querySelector(".phase-label")?.textContent === "here with you",
    null,
    { timeout: 15000 },
  );
  const scheduled = await scheduledWindow.evaluate(() => window.eva.snapshot());
  assert.equal(
    scheduled.messages.filter((m) => m.origin === "reminder").length,
    1,
    JSON.stringify({
      messages: scheduled.messages.map((m) => ({
        role: m.role,
        origin: m.origin,
        sessionId: m.sessionId,
      })),
      tasks: scheduled.autonomy.tasks,
      activity: scheduled.autonomy.activity,
      sessionId: scheduled.sessionId,
    }),
  );
  assert.equal(
    scheduled.autonomy.tasks.find((t) => t.title === "Cancelled reminder")
      .status,
    "cancelled",
  );
  assert.ok(
    scheduled.autonomy.activity.some(
      (e) => e.kind === "autonomous-reply" && e.requests === 1,
    ),
  );
  await scheduledWindow
    .getByRole("button", { name: "Pause autonomy", exact: true })
    .click();
  assert.equal(
    (await scheduledWindow.evaluate(() => window.eva.snapshot())).settings
      .autonomy.paused,
    true,
  );
  await desktop.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  });
  await scheduledWindow.evaluate(() => window.eva.clearHistory());
  const cleared = JSON.parse(
    await readFile(path.join(profile, "companion.json"), "utf8"),
  );
  assert.equal(cleared.messages.length, 0);
  assert.equal(cleared.facts.length, 1);
  await scheduledWindow.evaluate(() => window.eva.pluginAction("remove"));
  assert.equal(
    (await scheduledWindow.evaluate(() => window.eva.snapshot())).plugins
      .hasToken,
    false,
  );
  assert.equal(
    (await scheduledWindow.evaluate(() => window.eva.snapshot())).facts.length,
    1,
  );
  console.log(
    "Desktop smoke passed: plugin installation/settings, vault and grant persistence/removal, restart-safe authorized reminders, typing deferral, task cancellation, pause, activity logs, image attachments, credential persistence, models, semantic recall, all speech modes, barge-in, VRM and archives.",
  );
} finally {
  if (desktop) await desktop.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
