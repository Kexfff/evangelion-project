/** Fixed-origin Telegram transport. Errors never contain token-bearing URLs or bodies. */
export class TelegramError extends Error {
  constructor(
    readonly code: number,
    readonly retryAfter = 0,
  ) {
    super(
      code === 401
        ? "Telegram token rejected."
        : code === 409
          ? "Telegram polling conflict: stop other bot instances and remove any webhook."
          : code === 429
            ? "Telegram rate limit."
            : "Telegram request failed.",
    );
  }
}
export interface TelegramAPI {
  call(
    method: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown>;
  download(
    filePath: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<Uint8Array>;
  close(): Promise<void>;
}
const methods = new Set([
  "getMe",
  "getUpdates",
  "getFile",
  "sendMessage",
  "sendVoice",
]);
export async function boundedBody(response: Response, max: number) {
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel();
    throw new TelegramError(413);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new TelegramError(502);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) throw new TelegramError(413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks, length);
}
export class TelegramHTTP implements TelegramAPI {
  constructor(
    private token: string,
    private request: typeof fetch = fetch,
  ) {}
  async call(
    method: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (!methods.has(method)) throw new TelegramError(403);
    try {
      let payload: string | FormData;
      if (method === "sendVoice") {
        const audio = body.audio;
        if (!(audio instanceof Uint8Array) || audio.length > 10 * 1024 * 1024)
          throw new TelegramError(413);
        payload = new FormData();
        payload.set("chat_id", String(body.chat_id));
        payload.set(
          "voice",
          new Blob([Uint8Array.from(audio).buffer], { type: "audio/mpeg" }),
          "reply.mp3",
        );
      } else payload = JSON.stringify(body);
      const response = await this.request(
        `https://api.telegram.org/bot${this.token}/${method}`,
        {
          method: "POST",
          body: payload,
          redirect: "error",
          headers:
            typeof payload === "string"
              ? { "Content-Type": "application/json" }
              : undefined,
          signal: AbortSignal.any([signal, AbortSignal.timeout(40000)]),
        },
      );
      const data = JSON.parse(
        (await boundedBody(response, 1024 * 1024)).toString("utf8"),
      );
      if (!response.ok || data.ok !== true)
        throw new TelegramError(
          Number(data.error_code) || response.status,
          Math.max(1, Number(data.parameters?.retry_after) || 1),
        );
      return data.result;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof TelegramError) throw error;
      throw new TelegramError(502);
    }
  }
  async download(filePath: string, maxBytes: number, signal: AbortSignal) {
    if (
      !/^[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/.test(filePath) ||
      filePath.includes("..") ||
      filePath.startsWith("/") ||
      maxBytes > 10 * 1024 * 1024
    )
      throw new TelegramError(400);
    try {
      const response = await this.request(
        `https://api.telegram.org/file/bot${this.token}/${filePath}`,
        {
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        },
      );
      if (!response.ok) throw new TelegramError(response.status);
      return Uint8Array.from(await boundedBody(response, maxBytes));
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof TelegramError) throw error;
      throw new TelegramError(502);
    }
  }
  async close() {}
}
