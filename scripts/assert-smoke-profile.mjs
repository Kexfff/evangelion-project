import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import path from "node:path";

// Check before any fixture provider settings, chat, grants or world connections.
export async function assertSmokeProfile(desktop, profile) {
  const actual = await desktop.evaluate(({ app }) => ({
    userData: app.getPath("userData"),
    sessionData: app.getPath("sessionData"),
  }));
  const expected = await realpath(profile);
  assert.equal(
    await realpath(actual.userData),
    expected,
    "Unsafe smoke test: app ignored the isolated userData directory.",
  );
  assert.equal(
    await realpath(actual.sessionData),
    path.join(expected, "chromium"),
    "Unsafe smoke test: Chromium data is not isolated.",
  );
}
