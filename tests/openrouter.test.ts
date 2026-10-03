import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  OpenAICompatibleProvider,
  openRouterRouting,
} from "../electron/providers";
import { defaultSettings, providerSchema } from "../src/shared/schema";
import { isOpenRouter } from "../src/shared/openrouter";
import { Store } from "../electron/store";

afterEach(() => vi.unstubAllGlobals());
const adapter = new OpenAICompatibleProvider();
const provider = () => ({
  ...defaultSettings.providers.llm,
  model: "deepseek/deepseek-chat",
  openrouterProviders: {
    "deepseek/deepseek-chat": ["deepinfra/fp4", "streamlake"],
  },
});
const reply = () =>
  Response.json({ choices: [{ message: { content: "OK" } }] });
describe("OpenRouter model provider selection", () => {
  it("discovers exact endpoint tags with prices/tools, deduplicated and without credentials", async () => {
    const row = {
      tag: "deepinfra/fp4",
      provider_name: "DeepInfra",
      pricing: { prompt: "0.000001", completion: "0.000002" },
      supported_parameters: ["tools"],
    };
    const fetch = vi.fn(async () =>
      Response.json({
        data: {
          endpoints: [
            row,
            row,
            { provider_name: "No routing ID" },
            { tag: "streamlake", provider_name: "StreamLake" },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
      await adapter.openRouterProviders("deepseek/deepseek-chat:free"),
    ).toEqual([
      {
        id: "deepinfra/fp4",
        name: "DeepInfra",
        tools: true,
        inputPrice: "0.000001",
        outputPrice: "0.000002",
      },
      { id: "streamlake", name: "StreamLake", tools: false },
    ]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://openrouter.ai/api/v1/models/deepseek/deepseek-chat%3Afree/endpoints",
    );
    expect(init.headers).toBeUndefined();
    expect(init.redirect).toBe("error");
  });
  it("validates model IDs before fetching and rejects malformed discovery", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ data: { endpoints: [{ tag: "bad id" }] } }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      adapter.openRouterProviders("../../secrets"),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await expect(adapter.openRouterProviders("author/model")).rejects.toThrow(
      "no usable provider IDs",
    );
    fetch.mockImplementation(async () => Response.json({ data: {} }));
    await expect(adapter.openRouterProviders("author/model")).rejects.toThrow(
      "invalid provider list",
    );
  });
  it("accepts an empty catalog and redacts upstream failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: { endpoints: [] } })),
    );
    expect(await adapter.openRouterProviders("author/model")).toEqual([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("private upstream details", { status: 503 }),
      ),
    );
    await expect(adapter.openRouterProviders("author/model")).rejects.toThrow(
      "HTTP 503",
    );
  });
  it.each([false, true])(
    "routes normal chat with stream=%s only to selected providers",
    async (stream) => {
      const fetch = vi.fn(async () =>
        stream
          ? new Response(
              'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n',
              { headers: { "Content-Type": "text/event-stream" } },
            )
          : reply(),
      );
      vi.stubGlobal("fetch", fetch);
      await adapter.chat(
        provider(),
        "secret",
        [{ role: "user", content: "Hi" }],
        () => {},
        undefined,
        stream,
      );
      const body = JSON.parse(
        (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
          .body as string,
      );
      expect(body.provider).toEqual({ only: ["deepinfra/fp4", "streamlake"] });
    },
  );
  it("applies the selection on every tool-loop round", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                tool_calls: [
                  { id: "1", function: { name: "inspect", arguments: "{}" } },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(reply());
    vi.stubGlobal("fetch", fetch);
    const execute = vi.fn(async () => ({ ok: true }));
    await adapter.chatWithTools(
      provider(),
      "secret",
      [],
      [{ type: "function", function: { name: "inspect" } }],
      execute,
      new AbortController().signal,
      () => {},
      () => {},
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls)
      expect(JSON.parse(init.body).provider.only).toEqual([
        "deepinfra/fp4",
        "streamlake",
      ]);
  });
  it("keeps automatic/other-model/non-OpenRouter requests unchanged", () => {
    expect(
      openRouterRouting({ ...provider(), model: "another/model" }),
    ).toEqual({});
    expect(openRouterRouting(defaultSettings.providers.llm)).toEqual({});
    for (const baseUrl of [
      "http://localhost:8000/v1",
      "https://openrouter.ai.evil.test/api/v1",
      "https://openrouter.ai@evil.test/api/v1",
    ])
      expect(openRouterRouting({ ...provider(), baseUrl })).toEqual({});
    expect(isOpenRouter("https://openrouter.ai/api/v1/")).toBe(true);
  });
  it("rejects empty restricted lists rather than silently allowing any provider", () => {
    const empty = {
      ...provider(),
      openrouterProviders: { "deepseek/deepseek-chat": [] },
    };
    expect(() => providerSchema.parse(empty)).toThrow("Choose at least one");
    expect(() => openRouterRouting(empty)).toThrow("Choose at least one");
  });
  it("persists per-model choices across restart while migrating old settings unchanged", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "eva-routing-"));
    try {
      const store = new Store(dir);
      expect(
        store.data.settings.providers.llm.openrouterProviders,
      ).toBeUndefined();
      store.update((d) => {
        d.settings.providers.llm = provider();
      });
      expect(
        new Store(dir).data.settings.providers.llm.openrouterProviders,
      ).toEqual(provider().openrouterProviders);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
