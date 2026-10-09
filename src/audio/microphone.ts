import type { Settings } from "../shared/schema";
import { bridge } from "../bridge";
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
  private lease = crypto.randomUUID();
  private leased = false;
  private ready = false;
  private draining?: Promise<void>;
  private drained?: () => void;
  private deadline?: ReturnType<typeof setTimeout>;
  private voicedMs = 0;
  private vad: VoiceActivityDetector;
  private neural?: Awaited<
    ReturnType<typeof import("./neural-vad").createNeuralVad>
  >;
  private inference = Promise.resolve();
  private pendingFrames = 0;
  private captureRate = 16000;
  constructor(
    private voice: Settings["voice"],
    private callbacks: {
      level(n: number): void;
      start(): void;
      utterance(wav: ArrayBuffer): void;
      error(error: Error): void;
      acceptsSpeech(): boolean;
      ended?(): void;
    },
    private pressToTalk = false,
  ) {
    this.vad = new VoiceActivityDetector(
      voice.vadEnabled && voice.vadEngine === "silero"
        ? voice.neuralThreshold
        : voice.vadThreshold,
      voice.vadMinSpeechMs,
      voice.vadSilenceMs,
    );
  }
  async open() {
    try {
      if (!this.voice.vadEnabled)
        this.deadline = setTimeout(() => {
          if (!this.closed) {
            this.callbacks.error(
              new Error(
                "Recording cancelled after 60 seconds. Release the key and try a shorter message.",
              ),
            );
            this.close();
          }
        }, 60000);
      this.leased = await bridge.microphoneLease(this.lease, true);
      if (!this.leased)
        throw new Error(
          "The microphone is already in use by a recording or microphone test.",
        );
      if (this.closed) {
        this.releaseLease();
        return;
      }
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
      this.captureRate = context.sampleRate;
      if (this.voice.vadEnabled && this.voice.vadEngine === "silero") {
        const { createNeuralVad } = await import("./neural-vad");
        if (this.closed) return;
        const neural = await createNeuralVad(context.sampleRate);
        if (this.closed) {
          await neural.close();
          return;
        }
        this.neural = neural;
        this.captureRate = 16000;
      }
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
      node.port.onmessage = (event) => {
        if (event.data === "finished") this.drained?.();
        else if (this.neural) {
          if (++this.pendingFrames > 40) {
            this.callbacks.error(
              new Error(
                "Neural voice detection cannot keep up. Recording stopped; try the energy detector.",
              ),
            );
            this.close();
            return;
          }
          const samples = event.data as Float32Array;
          this.inference = this.inference
            .then(async () => {
              if (!this.closed)
                await this.neural!.process(samples, (frame, probability) =>
                  this.receive(frame, probability),
                );
            })
            .catch(() => {
              if (!this.closed) {
                this.callbacks.error(
                  new Error(
                    "Neural voice detection failed. Recording stopped; choose the energy detector to retry.",
                  ),
                );
                this.close();
              }
            })
            .finally(() => {
              this.pendingFrames--;
            });
        } else this.receive(event.data as Float32Array);
      };
      await context.resume();
      if (this.closed) return;
      this.ready = true;
      if (!this.voice.vadEnabled) {
        this.inSpeech = true;
        this.callbacks.start();
      }
    } catch (error) {
      if (!this.closed)
        this.callbacks.error(
          error instanceof Error ? error : new Error(String(error)),
        );
      this.close();
      throw error;
    }
  }
  private receive(samples: Float32Array, speechProbability?: number) {
    if (this.closed || !this.context) return;
    const level = rms(samples),
      ms = (samples.length / this.captureRate) * 1000;
    this.callbacks.level(level);
    if (level >= this.voice.vadThreshold) this.voicedMs += ms;
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
      const edge = this.vad.push(speechProbability ?? level, ms);
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
    if (this.lengthMs >= 60000 && this.voice.vadEnabled) this.finish();
  }
  async finishAndSend() {
    if (this.draining) return this.draining;
    if (this.closed) return;
    // Release before permission/worklet initialization: discard, never open later.
    if (!this.ready || !this.node) {
      this.close();
      return;
    }
    this.draining = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let flushed = false;
      await new Promise<void>((resolve) => {
        this.drained = () => {
          flushed = true;
          resolve();
        };
        timer = setTimeout(resolve, 250);
        this.node!.port.postMessage("finish");
      });
      clearTimeout(timer);
      await this.inference;
      this.drained = undefined;
      if (this.closed) return;
      if (!flushed) {
        this.callbacks.error(
          new Error(
            "Microphone did not finish cleanly; recording discarded. Try again.",
          ),
        );
        this.close();
        return;
      }
      this.finish();
    })();
    return this.draining;
  }
  finish() {
    if (!this.context || !this.inSpeech) return;
    const chunks = this.chunks;
    const enoughSpeech =
      !this.pressToTalk ||
      (this.lengthMs >= 200 && this.voicedMs >= this.voice.vadMinSpeechMs);
    this.chunks = [];
    this.preRoll = [];
    this.inSpeech = false;
    this.lengthMs = 0;
    this.vad.reset();
    if (chunks.length && enoughSpeech)
      this.callbacks.utterance(encodeWav(chunks, this.captureRate));
    if (!this.voice.vadEnabled) this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.deadline);
    this.drained?.();
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
    }
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    void this.context?.close().catch(() => {});
    void this.inference.then(() => this.neural?.close()).catch(() => {});
    this.chunks = [];
    this.preRoll = [];
    this.callbacks.level(0);
    this.releaseLease();
    this.callbacks.ended?.();
  }
  private releaseLease() {
    if (!this.leased) return;
    this.leased = false;
    void bridge.microphoneLease(this.lease, false).catch(() => {});
  }
}
