import { Worker } from "node:worker_threads";
import { TelegramError, type TelegramAPI } from "./telegram-api";

/** Worker isolates network work and has a V8 heap cap; it is NOT a hostile-code sandbox. */
export class TelegramTransport implements TelegramAPI {
  private worker: Worker;
  private sequence = 0;
  private closed = false;
  private pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  constructor(
    token: string,
    file = new URL("./telegram-worker.js", import.meta.url),
  ) {
    this.worker = new Worker(file, {
      workerData: { token },
      resourceLimits: {
        maxOldGenerationSizeMb: 64,
        maxYoungGenerationSizeMb: 16,
      },
    });
    this.worker.on("message", (message) => {
      const task = this.pending.get(message.id);
      if (!task) return;
      if (message.error)
        task.reject(new TelegramError(message.error, message.retryAfter));
      else task.resolve(message.result);
    });
    this.worker.on("error", () => {
      void this.close();
    });
    this.worker.on("exit", () => {
      void this.close();
    });
  }
  async call(
    method: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    if (this.closed) throw new TelegramError(503);
    if (this.pending.size >= 4) throw new TelegramError(429);
    const id = ++this.sequence;
    let abort!: () => void;
    let timeout!: ReturnType<typeof setTimeout>;
    try {
      return await new Promise<unknown>((resolve, reject) => {
        abort = () => {
          this.worker.postMessage({ id, cancel: true });
          reject(new TelegramError(499));
        };
        this.pending.set(id, { resolve, reject });
        signal.addEventListener("abort", abort, { once: true });
        timeout = setTimeout(() => {
          abort();
          void this.close();
        }, 45000);
        this.worker.postMessage({ id, method, body });
      });
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      this.pending.delete(id);
    }
  }
  async download(filePath: string, maxBytes: number, signal: AbortSignal) {
    return (await this.call(
      "download",
      { path: filePath, max: maxBytes },
      signal,
    )) as Uint8Array;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const task of this.pending.values())
      task.reject(new TelegramError(503));
    this.pending.clear();
    await this.worker.terminate();
  }
}
