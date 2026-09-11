export class VoiceActivityDetector {
  private speaking = false;
  private voicedMs = 0;
  private quietMs = 0;
  constructor(
    private threshold: number,
    private minSpeechMs: number,
    private silenceMs: number,
  ) {}
  push(rms: number, ms: number): "start" | "end" | undefined {
    if (!this.speaking) {
      this.voicedMs = rms >= this.threshold ? this.voicedMs + ms : 0;
      if (this.voicedMs >= this.minSpeechMs) {
        this.speaking = true;
        this.quietMs = 0;
        return "start";
      }
    } else {
      this.quietMs = rms < this.threshold * 0.65 ? this.quietMs + ms : 0;
      if (this.quietMs >= this.silenceMs) {
        this.reset();
        return "end";
      }
    }
  }
  reset() {
    this.speaking = false;
    this.voicedMs = 0;
    this.quietMs = 0;
  }
}
export function rms(samples: Float32Array) {
  return Math.sqrt(
    samples.reduce((sum, n) => sum + n * n, 0) / Math.max(1, samples.length),
  );
}
export function encodeWav(chunks: Float32Array[], inputRate: number) {
  const count = chunks.reduce((n, c) => n + c.length, 0);
  const joined = new Float32Array(count);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  const rate = 16000,
    length = Math.floor((count * rate) / inputRate);
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const ascii = (at: number, value: string) =>
    [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    // Average each source interval for simple low-pass downsampling.
    const start = Math.floor((i * inputRate) / rate),
      end = Math.max(start + 1, Math.floor(((i + 1) * inputRate) / rate));
    let sample = 0;
    for (let n = start; n < Math.min(end, count); n++) sample += joined[n];
    sample = Math.max(-1, Math.min(1, sample / (end - start)));
    view.setInt16(44 + i * 2, sample * (sample < 0 ? 32768 : 32767), true);
  }
  return bytes;
}
