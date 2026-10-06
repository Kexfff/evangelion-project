import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/shared/schema";
const lease = vi.hoisted(() =>
  vi.fn(async (_id: string, _acquire: boolean) => true),
);
vi.mock("../src/bridge", () => ({ bridge: { microphoneLease: lease } }));
import { MicrophoneCapture } from "../src/audio/microphone";

let currentNode: {
  port: {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
  };
};
let track: { stop: ReturnType<typeof vi.fn>; onended: (() => void) | null };
let context: {
  sampleRate: number;
  audioWorklet: { addModule: ReturnType<typeof vi.fn> };
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  createMediaStreamSource: ReturnType<typeof vi.fn>;
  createGain: ReturnType<typeof vi.fn>;
  destination: object;
};
const mic = (ptt = true) => {
  const callbacks = {
    start: vi.fn(),
    level: vi.fn(),
    error: vi.fn<(e: Error) => void>(),
    utterance: vi.fn<(wav: ArrayBuffer) => void>(),
    ended: vi.fn(),
    acceptsSpeech: () => true,
  };
  return {
    callbacks,
    capture: new MicrophoneCapture(
      { ...defaultSettings.voice, vadEnabled: false },
      callbacks,
      ptt,
    ),
  };
};
beforeEach(() => {
  vi.useFakeTimers();
  lease.mockReset().mockResolvedValue(true);
  track = { stop: vi.fn(), onended: null };
  context = {
    sampleRate: 16000,
    audioWorklet: { addModule: vi.fn(async () => {}) },
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    createMediaStreamSource: vi.fn(() => ({ connect() {} })),
    createGain: vi.fn(() => ({ gain: { value: 1 }, connect() {} })),
    destination: {},
  };
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })),
    },
  });
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        return context;
      }
    },
  );
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(() => {
          queueMicrotask(() => this.port.onmessage?.({ data: "finished" }));
        }),
      };
      constructor() {
        currentNode = this;
      }
      connect() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const samples = (seconds: number, level = 0.1) =>
  currentNode.port.onmessage?.({
    data: new Float32Array(16000 * seconds).fill(level),
  });

describe("explicit microphone capture lifecycle", () => {
  it("drains trailing worklet frames and submits at most once", async () => {
    const { capture, callbacks } = mic();
    await capture.open();
    samples(0.5);
    currentNode.port.postMessage.mockImplementation(() => {
      samples(0.1);
      queueMicrotask(() => currentNode.port.onmessage?.({ data: "finished" }));
    });
    const finish = capture.finishAndSend();
    const duplicate = capture.finishAndSend();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([finish, duplicate]);
    expect(callbacks.utterance).toHaveBeenCalledOnce();
    expect(callbacks.utterance.mock.calls[0][0].byteLength).toBe(
      44 + 16000 * 0.6 * 2,
    );
    expect(track.stop).toHaveBeenCalledOnce();
    expect(lease.mock.calls.at(-1)?.[1]).toBe(false);
  });
  it.each([
    [0.1, 0.1],
    [0.7, 0],
  ])(
    "discards short or quiet recordings (%ss at %s)",
    async (duration, level) => {
      const { capture, callbacks } = mic();
      await capture.open();
      samples(duration, level);
      const finish = capture.finishAndSend();
      await vi.advanceTimersByTimeAsync(1);
      await finish;
      expect(callbacks.utterance).not.toHaveBeenCalled();
      expect(callbacks.ended).toHaveBeenCalledOnce();
    },
  );
  it("release before permission resolves cannot start recording later", async () => {
    let allow!: (stream: unknown) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
      () =>
        new Promise((resolve) => {
          allow = resolve as typeof allow;
        }),
    );
    const { capture, callbacks } = mic();
    const open = capture.open();
    await Promise.resolve();
    await capture.finishAndSend();
    allow({ getTracks: () => [track] });
    await open;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(callbacks.start).not.toHaveBeenCalled();
    expect(callbacks.utterance).not.toHaveBeenCalled();
  });
  it("release while waiting for the shared lease releases the late lease", async () => {
    let allow!: (value: boolean) => void;
    lease.mockImplementationOnce(
      () =>
        new Promise((r) => {
          allow = r;
        }),
    );
    const { capture, callbacks } = mic();
    const open = capture.open();
    await capture.finishAndSend();
    allow(true);
    await open;
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(callbacks.utterance).not.toHaveBeenCalled();
    expect(lease.mock.calls.at(-1)?.[1]).toBe(false);
  });
  it("refuses a second microphone owner before opening the device", async () => {
    lease.mockResolvedValue(false);
    const { capture, callbacks } = mic();
    await expect(capture.open()).rejects.toThrow("already in use");
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(callbacks.error).toHaveBeenCalledOnce();
  });
  it("cancellation during the drain does not submit uncertain audio", async () => {
    const { capture, callbacks } = mic();
    await capture.open();
    samples(0.5);
    currentNode.port.postMessage.mockImplementation(() => {});
    const finish = capture.finishAndSend();
    capture.close();
    await finish;
    expect(callbacks.utterance).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it("a lost release cancels at the wall-clock limit, never auto-sends", async () => {
    const { capture, callbacks } = mic();
    await capture.open();
    samples(0.5);
    await vi.advanceTimersByTimeAsync(60000);
    expect(callbacks.error.mock.calls[0][0].message).toContain("60 seconds");
    expect(callbacks.utterance).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it("device removal discards the capture and reports a useful error", async () => {
    const { capture, callbacks } = mic();
    await capture.open();
    samples(0.5);
    track.onended?.();
    expect(callbacks.error.mock.calls[0][0].message).toContain("disconnected");
    expect(callbacks.utterance).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it("forwards the chosen device and processing settings", async () => {
    const callbacks = {
      start() {},
      level() {},
      error() {},
      utterance() {},
      acceptsSpeech: () => true,
    };
    const capture = new MicrophoneCapture(
      {
        ...defaultSettings.voice,
        inputDeviceId: "chosen",
        noiseSuppression: false,
      },
      callbacks,
      true,
    );
    await capture.open();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({
        deviceId: { exact: "chosen" },
        noiseSuppression: false,
      }),
    });
    capture.close();
  });
});
