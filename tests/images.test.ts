import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../electron/store";
import { CompanionRuntime } from "../electron/runtime";
import { buildContext } from "../electron/memory";
import { memoryExportSchema } from "../src/shared/schema";
import {
  imageAttachmentSchema,
  outgoingMessageSchema,
  MAX_IMAGE_BYTES,
} from "../src/shared/images";

const image = {
  name: "pixel.png",
  dataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
};
const directories: string[] = [];
function setup() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "eva-images-"));
  directories.push(directory);
  const store = new Store(directory);
  const runtime = new CompanionRuntime(
    store,
    () => "",
    "local-file",
    () => {},
  );
  return { store, runtime, directory };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true });
});

it("validates image-only messages, size, count, MIME and inline-only data", () => {
  expect(
    outgoingMessageSchema.parse({ text: "", images: [image] }).images,
  ).toEqual([image]);
  expect(outgoingMessageSchema.safeParse({ text: " " }).success).toBe(false);
  expect(
    outgoingMessageSchema.safeParse({
      text: "hi",
      images: Array(5).fill(image),
    }).success,
  ).toBe(false);
  for (const dataUrl of [
    "https://example.com/image.png",
    "file:///tmp/image.png",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,aGVsbG8=",
    image.dataUrl.replace("png", "jpeg"),
    image.dataUrl + "!",
  ])
    expect(imageAttachmentSchema.safeParse({ ...image, dataUrl }).success).toBe(
      false,
    );
  const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1);
  Buffer.from("89504e470d0a1a0a", "hex").copy(oversized);
  expect(
    imageAttachmentSchema.safeParse({
      ...image,
      dataUrl: `data:image/png;base64,${oversized.toString("base64")}`,
    }).success,
  ).toBe(false);
});

it("sends text-first image_url parts over HTTP and preserves attachments across restart/export", async () => {
  const { store, runtime, directory } = setup();
  const fetch = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "A pixel." } }] }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
  vi.stubGlobal("fetch", fetch);
  await runtime.send("Describe this", [image]);
  const content = JSON.parse(fetch.mock.calls[0][1].body).messages.at(
    -1,
  ).content;
  expect(content).toEqual([
    { type: "text", text: "Describe this" },
    { type: "image_url", image_url: { url: image.dataUrl } },
  ]);
  const reopened = new Store(directory);
  expect(reopened.snapshot("local-file", false).messages[0].images).toEqual([
    image,
  ]);
  const archive = memoryExportSchema.parse(
    JSON.parse(
      JSON.stringify({ version: 1, facts: [], messages: store.data.messages }),
    ),
  );
  expect(archive.messages[0].images).toEqual([image]);
  await runtime.send("What color is it?");
  expect(
    JSON.stringify(JSON.parse(fetch.mock.calls[1][1].body).messages),
  ).toContain(image.dataUrl);
});

it("supports image-only turns without empty embedding or automatic fact requests", async () => {
  const { store, runtime } = setup();
  store.update((d) => {
    d.settings.memory.semanticEnabled = true;
    d.settings.memory.autoRemember = true;
  });
  const chat = vi.spyOn(runtime.provider, "chat").mockResolvedValue("A pixel.");
  const embed = vi.spyOn(runtime.provider, "embed");
  await runtime.send("", [image]);
  expect(chat).toHaveBeenCalledTimes(1);
  expect(chat.mock.calls[0][2].at(-1)?.content).toEqual([
    { type: "text", text: "What do you see in these images?" },
    { type: "image_url", image_url: { url: image.dataUrl } },
  ]);
  expect(embed).not.toHaveBeenCalled();
  expect(store.data.messages[0].content).toBe("");
});

it("bounds visual context, keeps the newest images, and isolates characters and older sessions", () => {
  const { store } = setup();
  store.update((d) => {
    d.messages = Array.from({ length: 6 }, (_, i) => ({
      id: `${i}`,
      characterId: "eva",
      sessionId: store.sessionId,
      role: "user",
      content: "x".repeat(8000),
      images: [{ ...image, name: `${i}.png` }],
      createdAt: new Date().toISOString(),
    }));
    d.messages[0].sessionId = "older-session";
    d.messages[1].characterId = "other";
    d.messages[5].images = Array(4).fill(image);
  });
  const context = buildContext(store.data, "x").slice(1);
  const parts = context.flatMap((m) =>
    typeof m.content === "string"
      ? [{ type: "text", text: m.content } as const]
      : m.content,
  );
  expect(parts.filter((p) => p.type === "image_url")).toHaveLength(4);
  expect(
    parts.reduce((sum, p) => sum + (p.type === "text" ? p.text.length : 0), 0),
  ).toBeLessThanOrEqual(24000);
  expect(context.at(-1)?.content).toHaveLength(5);
  expect(JSON.stringify(context)).toContain("Older image attachments omitted");
});

it("does not embed image bytes and rejects invalid sends before changing history", async () => {
  const { store, runtime } = setup();
  const chat = vi.spyOn(runtime.provider, "chat").mockResolvedValue("Okay.");
  await expect(
    runtime.send("test", [{ ...image, dataUrl: "file:///private" }]),
  ).rejects.toThrow();
  expect(store.data.messages).toHaveLength(0);
  expect(chat).not.toHaveBeenCalled();
  await runtime.send("My cat", [image]);
  await runtime.send("", [image]);
  const embed = vi
    .spyOn(runtime.provider, "embed")
    .mockImplementation(async (_p, _k, texts) => texts.map(() => [1, 0]));
  expect(await runtime.semantic.reindex()).toEqual({ indexed: 2, total: 2 });
  expect(embed.mock.calls[0][2][0]).toContain("My cat");
  expect(JSON.stringify(embed.mock.calls)).not.toContain("data:image");
});
