import { parentPort, workerData } from "node:worker_threads";
import { TelegramHTTP, TelegramError } from "./telegram-api";
import { z } from "zod";

const api = new TelegramHTTP(
  z
    .string()
    .regex(/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/)
    .parse(workerData.token),
);
const controllers = new Map<number, AbortController>();
parentPort!.on("message", async (message) => {
  const id = message.id;
  if (!Number.isSafeInteger(id)) return;
  if (message.cancel) {
    controllers.get(id)?.abort();
    return;
  }
  if (controllers.size >= 4) {
    parentPort!.postMessage({ id, error: 429 });
    return;
  }
  const controller = new AbortController();
  controllers.set(id, controller);
  try {
    const result =
      message.method === "download"
        ? await api.download(
            z.string().max(300).parse(message.body.path),
            z
              .number()
              .int()
              .positive()
              .max(10 * 1024 * 1024)
              .parse(message.body.max),
            controller.signal,
          )
        : await api.call(
            z.string().parse(message.method),
            message.body,
            controller.signal,
          );
    parentPort!.postMessage({ id, result });
  } catch (error) {
    parentPort!.postMessage({
      id,
      error: error instanceof TelegramError ? error.code : 502,
      retryAfter: error instanceof TelegramError ? error.retryAfter : 0,
    });
  } finally {
    controllers.delete(id);
  }
});
