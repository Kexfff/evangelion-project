import type { Provider } from "../src/shared/schema";
import type { ChatMessage } from "./memory";
export type Usage = { tokens?: number; cost?: number };
function usageOf(raw: any): Usage {
  return {
    ...(Number.isFinite(raw?.total_tokens) && raw.total_tokens >= 0
      ? { tokens: raw.total_tokens }
      : {}),
    ...(Number.isFinite(raw?.cost) && raw.cost >= 0 ? { cost: raw.cost } : {}),
  };
}

export function endpoint(base: string, route: string) {
  return `${base.replace(/\/+$/, "")}/${route}`;
}
export function providerSignal(signal?: AbortSignal) {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
    : AbortSignal.timeout(90000);
}
function headers(key: string): Record<string, string> {
  return key ? { Authorization: `Bearer ${key}` } : {};
}
async function checked(response: Response) {
  if (!response.ok) {
    // Do not reflect upstream bodies: some gateways include credentials and internal URLs.
    await response.body?.cancel();
    throw new Error(
      `Provider returned HTTP ${response.status}. Check its URL, model, credentials, and quota in Settings.`,
    );
  }
  return response;
}
export async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
  onUsage?: (usage: Usage) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "",
    result = "",
    finished = false;
  const parse = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === "[DONE]") {
      finished = true;
      return;
    }
    const json = JSON.parse(data);
    if (json.usage) onUsage?.(usageOf(json.usage));
    if (json.error)
      throw new Error(
        "The provider reported a streaming error. Check the model and quota.",
      );
    if (json.choices?.[0]?.finish_reason) finished = true;
    const text = json.choices?.[0]?.delta?.content;
    if (typeof text === "string") {
      result += text;
      onText(text);
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) parse(line.replace(/\r$/, ""));
      if (done) {
        if (pending.trim()) parse(pending);
        break;
      }
      if (finished) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!finished)
    throw new Error(
      "The response stream ended unexpectedly. Please try again.",
    );
  if (!result.trim())
    throw new Error("The model returned no text. Try another model.");
  return result;
}
export class OpenAICompatibleProvider {
  async models(provider: Provider, key: string, embedding = false) {
    // OpenRouter exposes embedding models separately; other compatible servers use /models.
    const route =
      embedding && new URL(provider.baseUrl).hostname === "openrouter.ai"
        ? "embeddings/models"
        : "models";
    const response = await checked(
      await fetch(endpoint(provider.baseUrl, route), {
        headers: headers(key),
        signal: providerSignal(),
      }),
    );
    const data = await response.json();
    if (!Array.isArray(data.data))
      throw new Error(
        "This provider does not return an OpenAI-compatible model list. Enter a model ID manually.",
      );
    return [
      ...new Set<string>(
        data.data
          .filter(
            (m: { id?: unknown }) =>
              typeof m.id === "string" && m.id.length <= 200,
          )
          .map((m: { id: string }) => m.id),
      ),
    ].sort();
  }
  async embed(
    provider: Provider,
    key: string,
    input: string[],
    signal?: AbortSignal,
  ): Promise<number[][]> {
    if (!provider.enabled || !provider.model.trim())
      throw new Error(
        "Enable an embedding provider and choose its model in Settings.",
      );
    const response = await checked(
      await fetch(endpoint(provider.baseUrl, "embeddings"), {
        method: "POST",
        headers: { ...headers(key), "Content-Type": "application/json" },
        body: JSON.stringify({
          model: provider.model,
          input,
          encoding_format: "float",
        }),
        signal: providerSignal(signal),
      }),
    );
    const data = await response.json();
    if (!Array.isArray(data.data) || data.data.length !== input.length)
      throw new Error("Embedding provider returned an incomplete batch.");
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    const dimensions = sorted[0]?.embedding?.length;
    if (
      !dimensions ||
      dimensions > 16384 ||
      sorted.some(
        (x, i) =>
          x.index !== i ||
          !Array.isArray(x.embedding) ||
          x.embedding.length !== dimensions ||
          x.embedding.some(
            (n: unknown) => typeof n !== "number" || !Number.isFinite(n),
          ),
      )
    )
      throw new Error("Embedding provider returned invalid vectors.");
    return sorted.map((x) => x.embedding);
  }
  async chat(
    provider: Provider,
    key: string,
    messages: ChatMessage[],
    onText: (s: string) => void,
    signal?: AbortSignal,
    stream = true,
    onUsage?: (usage: Usage) => void,
  ) {
    if (!provider.enabled || !provider.model.trim())
      throw new Error(
        "Enable the language provider and set a model in Settings.",
      );
    const response = await checked(
      await fetch(endpoint(provider.baseUrl, "chat/completions"), {
        method: "POST",
        headers: {
          ...headers(key),
          "Content-Type": "application/json",
          "X-OpenRouter-Title": "evangelion_project",
        },
        body: JSON.stringify({
          model: provider.model,
          messages,
          stream,
          temperature: 0.8,
          max_tokens: 700,
        }),
        signal: providerSignal(signal),
      }),
    );
    if (
      stream &&
      response.headers.get("content-type")?.includes("text/event-stream") &&
      response.body
    )
      return consumeSSE(response.body, onText, onUsage);
    const data = await response.json();
    if (data.usage) onUsage?.(usageOf(data.usage));
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim())
      throw new Error("The model returned no text.");
    onText(content);
    return content;
  }
  async chatWithTools(
    provider: Provider,
    key: string,
    messages: ChatMessage[],
    tools: unknown[],
    execute: (name: string, args: unknown) => unknown,
    signal: AbortSignal,
    onRequest: () => void,
    onUsage: (usage: Usage) => void,
  ) {
    if (!provider.enabled || !provider.model.trim())
      throw new Error(
        "Enable the LLM provider and choose a tool-capable model.",
      );
    const history: unknown[] = [...messages];
    // A bounded non-streaming tool loop prevents partial tool JSON or intermediate
    // planning text from being spoken. Normal/tool-disabled chat still streams.
    for (let round = 0; round < 4; round++) {
      signal.throwIfAborted();
      onRequest();
      const response = await checked(
        await fetch(endpoint(provider.baseUrl, "chat/completions"), {
          method: "POST",
          headers: { ...headers(key), "Content-Type": "application/json" },
          body: JSON.stringify({
            model: provider.model,
            messages: history,
            tools,
            tool_choice: round === 3 ? "none" : "auto",
            parallel_tool_calls: false,
            stream: false,
            max_tokens: 700,
          }),
          signal: providerSignal(signal),
        }),
      );
      const data = await response.json();
      onUsage(usageOf(data.usage));
      signal.throwIfAborted();
      const message = data.choices?.[0]?.message;
      if (!message) throw new Error("Tool-capable model returned no message.");
      if (!message.tool_calls?.length) {
        if (typeof message.content !== "string" || !message.content.trim())
          throw new Error("Model returned no text.");
        return message.content;
      }
      if (
        round === 3 ||
        !Array.isArray(message.tool_calls) ||
        message.tool_calls.length > 4
      )
        throw new Error("Scheduling tool limit exceeded.");
      history.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      });
      for (const call of message.tool_calls) {
        signal.throwIfAborted();
        if (
          typeof call.id !== "string" ||
          typeof call.function?.arguments !== "string" ||
          call.function.arguments.length > 8000
        )
          throw new Error("Invalid scheduling tool call.");
        let result: unknown;
        try {
          result = execute(
            call.function.name,
            JSON.parse(call.function.arguments),
          );
        } catch {
          result = {
            error:
              "Invalid or unauthorized task operation. Use a future ISO timestamp with offset, valid IANA time zone and an existing task ID. Creation always requires user approval.",
          };
        }
        history.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }
    throw new Error("Scheduling tool limit exceeded.");
  }
  async transcribe(
    provider: Provider,
    key: string,
    bytes: ArrayBuffer,
    mime: string,
    language: string,
    signal?: AbortSignal,
  ) {
    if (!provider.enabled || !provider.model.trim())
      throw new Error("Enable the ASR provider and set its model in Settings.");
    const form = new FormData();
    const ext = mime.includes("ogg")
      ? "ogg"
      : mime.includes("mp4")
        ? "m4a"
        : mime.includes("wav")
          ? "wav"
          : "webm";
    form.append("file", new Blob([bytes], { type: mime }), `recording.${ext}`);
    form.append("model", provider.model);
    form.append("response_format", "json");
    if (language.trim()) form.append("language", language.trim());
    const response = await checked(
      await fetch(endpoint(provider.baseUrl, "audio/transcriptions"), {
        method: "POST",
        headers: headers(key),
        body: form,
        signal: providerSignal(signal),
      }),
    );
    const data = await response.json();
    if (typeof data.text !== "string" || !data.text.trim())
      throw new Error(
        "No speech was recognized. Try speaking a little closer to the microphone.",
      );
    return data.text.trim();
  }
  async speak(
    provider: Provider,
    key: string,
    input: string,
    speed: number,
    signal?: AbortSignal,
  ) {
    const response = await this.speechResponse(
      provider,
      key,
      input,
      speed,
      signal,
    );
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength)
      throw new Error("The speech provider returned empty audio.");
    return bytes;
  }
  async speechResponse(
    provider: Provider,
    key: string,
    input: string,
    speed: number,
    signal?: AbortSignal,
  ) {
    if (!provider.enabled || !provider.model.trim())
      throw new Error("Enable the TTS provider and set its model in Settings.");
    const response = await checked(
      await fetch(endpoint(provider.baseUrl, "audio/speech"), {
        method: "POST",
        headers: { ...headers(key), "Content-Type": "application/json" },
        body: JSON.stringify({
          model: provider.model,
          input,
          voice: provider.voice,
          speed,
          response_format: "mp3",
        }),
        signal: providerSignal(signal),
      }),
    );
    if (response.headers.get("content-type")?.includes("json"))
      throw new Error(
        "The speech provider returned JSON instead of audio. Check its endpoint.",
      );
    if (!response.body)
      throw new Error("The speech provider returned no audio stream.");
    return response;
  }
}
