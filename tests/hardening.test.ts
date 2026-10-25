import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWrite } from "../electron/store";
import {
  OpenAICompatibleProvider,
  ResponseTooLargeError,
} from "../electron/providers";
import { defaultSettings } from "../src/shared/schema";

const directories: string[] = [];
function makeDirectory() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "eva-hardening-"));
  directories.push(dir);
  return dir;
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true });
});

describe("atomicWrite", () => {
  it("never writes through a symlink planted at the old temporary path", () => {
    const dir = makeDirectory();
    const victim = path.join(dir, "victim.txt");
    const file = path.join(dir, "export.json");
    writeFileSync(victim, "untouched");
    symlinkSync(victim, `${file}.tmp`);
    atomicWrite(file, "archive");
    expect(readFileSync(file, "utf8")).toBe("archive");
    expect(readFileSync(victim, "utf8")).toBe("untouched");
  });
  it("leaves no temporary files behind", () => {
    const dir = makeDirectory();
    atomicWrite(path.join(dir, "a.json"), "1");
    atomicWrite(path.join(dir, "a.json"), "2");
    expect(readdirSync(dir)).toEqual(["a.json"]);
  });
});

describe("provider response limits", () => {
  const provider = new OpenAICompatibleProvider();
  it("rejects a declared oversized body without reading it", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          headers: { "Content-Length": String(1024 * 1024 * 1024) },
        }),
      ),
    );
    await expect(
      provider.models(defaultSettings.providers.llm, "", "llm"),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(cancel).toHaveBeenCalled();
  });
  it("stops reading an endless body", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await expect(
      provider.models(defaultSettings.providers.llm, "", "llm"),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(pulled).toBeLessThan(40);
  });
});
