import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { assertSmokeProfile } from "./assert-smoke-profile.mjs";

// No game/provider connections. Optional read-only guard proves the normal profile is unchanged.
const guarded = process.env.EVA_TEST_GUARD_PROFILE;
const digest = async () =>
  guarded
    ? createHash("sha256")
        .update(await readFile(guarded))
        .digest("hex")
    : undefined;
const before = await digest();
const profile = await mkdtemp(path.join(tmpdir(), "eva-isolation-smoke-"));
let desktop;
try {
  desktop = await electron.launch({
    ...(process.env.EVA_TEST_EXECUTABLE
      ? { executablePath: process.env.EVA_TEST_EXECUTABLE }
      : {}),
    args: [
      ...(process.env.EVA_TEST_EXECUTABLE ? [] : ["."]),
      "--enable-unsafe-swiftshader",
      "--password-store=basic",
    ],
    env: { ...process.env, EVA_DEV_URL: "", EVA_TEST_DATA_DIR: profile },
  });
  await assertSmokeProfile(desktop, profile);
  await expect
    .poll(() =>
      desktop.windows().some((w) => w.url().includes("window=companion")),
    )
    .toBe(true);
  const win = desktop
    .windows()
    .find((w) => w.url().includes("window=companion"));
  await win
    .locator('.avatar-renderer[data-animation="idle_loop"]')
    .waitFor({ timeout: 60000 });
  await win.evaluate(async () => {
    const s = await window.eva.snapshot();
    s.settings.providers.llm.baseUrl =
      "http://127.0.0.1:54321/isolation-canary";
    await window.eva.saveSettings(s.settings, {});
  });
  const saved = JSON.parse(
    await readFile(path.join(profile, "companion.json"), "utf8"),
  );
  assert.equal(
    saved.settings.providers.llm.baseUrl,
    "http://127.0.0.1:54321/isolation-canary",
  );
  console.log(
    "Isolation smoke passed: actual Electron paths and fixture writes use the disposable profile.",
  );
} finally {
  if (desktop) await desktop.close();
  assert.equal(
    await digest(),
    before,
    "Normal profile changed during isolation test.",
  );
  await rm(profile, { recursive: true, force: true });
}
