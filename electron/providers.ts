import type { Provider } from "../src/shared/schema";
import type { ChatMessage } from "./memory";

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
  async chat(
    provider: Provider,
    key: string,
    messages: ChatMessage[],
    onText: (s: string) => void,
    signal?: AbortSignal,
    stream = true,
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
      return consumeSSE(response.body, onText);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim())
      throw new Error("The model returned no text.");
    onText(content);
    return content;
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
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength)
      throw new Error("The speech provider returned empty audio.");
    return bytes;
  }
}
