// Test-only network fixture; production worker never imports this module.
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/getUpdates")) {
    return new Promise((_, reject) =>
      init!.signal!.addEventListener(
        "abort",
        () => reject(new Error("Aborted")),
        { once: true },
      ),
    );
  }
  if (url.includes("/file/"))
    return new Response(new Uint8Array([255, 216, 255, 224]));
  if (url.endsWith("/getMe"))
    return new Response(
      JSON.stringify({ ok: true, result: { id: 123456, is_bot: true } }),
    );
  return new Response(
    JSON.stringify({ ok: true, result: { delivered: true } }),
  );
};
await import("../../electron/telegram-worker");
export {};
