import type { Settings } from "../shared/schema";
import { encodeWav, rms, VoiceActivityDetector } from "./vad";

export class MicrophoneCapture {
  private context?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private closed = false;
  private chunks: Float32Array[] = [];
  private preRoll: Float32Array[] = [];
  private lengthMs = 0;
  private inSpeech = false;
  private vad: VoiceActivityDetector;
  constructor(
    private voice: Settings["voice"],
    private callbacks: {
      level(n: number): void;
      start(): void;
      utterance(wav: ArrayBuffer): void;
      error(error: Error): void;
      acceptsSpeech(): boolean;
    },
  ) {
    this.vad = new VoiceActivityDetector(
      voice.vadThreshold,
      voice.vadMinSpeechMs,
      voice.vadSilenceMs,
    );
  }
  async open() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.voice.inputDeviceId
            ? { exact: this.voice.inputDeviceId }
            : undefined,
          echoCancellation: this.voice.echoCancellation,
          noiseSuppression: this.voice.noiseSuppression,
          autoGainControl: this.voice.autoGainControl,
          channelCount: 1,
        },
      });
      if (this.closed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      for (const track of stream.getTracks())
        track.onended = () => {
          if (!this.closed) {
            this.callbacks.error(
              new Error(
                "Microphone disconnected. Select an available input device.",
              ),
            );
            this.close();
          }
        };
      const context = new AudioContext();
      this.context = context;
      await context.audioWorklet.addModule(
        new URL("./capture-worklet.js", import.meta.url),
      );
      if (this.closed) return;
      const node = new AudioWorkletNode(context, "eva-capture");
      this.node = node;
      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      gain.gain.value = this.voice.inputGain;
      source.connect(gain);
      gain.connect(node);
      node.connect(context.destination);
      node.port.onmessage = (event) => this.receive(event.data as Float32Array);
      await context.resume();
      if (!this.voice.vadEnabled) {
        this.inSpeech = true;
        this.callbacks.start();
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }
  private receive(samples: Float32Array) {
    if (this.closed || !this.context) return;
    const level = rms(samples),
      ms = (samples.length / this.context.sampleRate) * 1000;
    this.callbacks.level(level);
    if (!this.callbacks.acceptsSpeech()) {
      this.vad.reset();
      this.chunks = [];
      this.preRoll = [];
      this.inSpeech = false;
      this.lengthMs = 0;
      return;
    }
    if (this.voice.vadEnabled) {
      if (!this.inSpeech) {
        this.preRoll.push(samples);
        while (
          this.preRoll.length * ms >
          Math.max(350, this.voice.vadMinSpeechMs + 150)
        )
          this.preRoll.shift();
      }
      const edge = this.vad.push(level, ms);
      if (edge === "start") {
        this.inSpeech = true;
        this.chunks = [...this.preRoll];
        this.preRoll = [];
        this.lengthMs = this.chunks.length * ms;
        this.callbacks.start();
      } else if (this.inSpeech) {
        this.chunks.push(samples);
        this.lengthMs += ms;
      }
      if (edge === "end" && this.inSpeech) this.finish();
    } else {
      this.chunks.push(samples);
      this.lengthMs += ms;
    }
    if (this.lengthMs >= 60000) this.finish();
  }
  finish() {
    if (!this.context || !this.inSpeech) return;
    const chunks = this.chunks;
    this.chunks = [];
    this.preRoll = [];
    this.inSpeech = false;
    this.lengthMs = 0;
    this.vad.reset();
    if (chunks.length)
      this.callbacks.utterance(encodeWav(chunks, this.context.sampleRate));
    if (!this.voice.vadEnabled) this.close();
  }
  close() {
    this.closed = true;
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
    }
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    void this.context?.close().catch(() => {});
    this.chunks = [];
    this.preRoll = [];
    this.callbacks.level(0);
  }
}
