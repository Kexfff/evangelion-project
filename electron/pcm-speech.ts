const MAX_PCM_BYTES = 64 * 1024 * 1024;

/** Compatible PCM is signed 16-bit little-endian audio. Wrap it for browser decoding. */
export async function pcmSpeechToWav(response: Response, signal?: AbortSignal) {
  const mime = response.headers.get("content-type") ?? "";
  const parameter = (name: string, fallback: number) => {
    const match = new RegExp(`;\\s*${name}\\s*=\\s*"?([^;"\\s]+)`, "i").exec(
      mime,
    );
    return match ? Number(match[1]) : fallback;
  };
  const rate = parameter("rate", 24000),
    channels = parameter("channels", 1);
  if (
    !Number.isInteger(rate) ||
    rate < 8000 ||
    rate > 192000 ||
    ![1, 2].includes(channels)
  ) {
    await response.body?.cancel();
    throw new Error(
      "The speech provider returned unsupported PCM sample settings.",
    );
  }
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PCM_BYTES)
        throw new Error(
          "The speech provider returned too much PCM audio. Try a shorter reply.",
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!size) throw new Error("The speech provider returned empty audio.");
  if (size % (channels * 2))
    throw new Error("The speech provider returned incomplete PCM audio.");
  const wav = new Uint8Array(44 + size);
  const view = new DataView(wav.buffer);
  const label = (at: number, text: string) =>
    wav.set(new TextEncoder().encode(text), at);
  label(0, "RIFF");
  view.setUint32(4, 36 + size, true);
  label(8, "WAVE");
  label(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  label(36, "data");
  view.setUint32(40, size, true);
  let offset = 44;
  for (const chunk of chunks) {
    wav.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(wav.buffer, { headers: { "Content-Type": "audio/wav" } });
}
