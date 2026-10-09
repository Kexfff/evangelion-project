import * as ort from "onnxruntime-web/wasm";
import { Silero } from "@ricky0123/vad-web/dist/models/silero";
import { Resampler } from "@ricky0123/vad-web/dist/resampler";
import modelUrl from "@ricky0123/vad-web/dist/silero_vad_v5.onnx?url";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import runtimeUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";

/** Uses the existing microphone lease/worklet. No second stream and no CDN requests. */
export async function createNeuralVad(rate: number) {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: runtimeUrl };
  const model = await Silero.new(ort, async () => {
    const response = await fetch(modelUrl);
    if (!response.ok)
      throw new Error("Bundled speech detector could not be loaded.");
    return response.arrayBuffer();
  });
  const resampler = new Resampler({
    nativeSampleRate: rate,
    targetSampleRate: 16000,
    targetFrameSize: 512,
  });
  return {
    async process(
      samples: Float32Array,
      onFrame: (frame: Float32Array, speech: number) => void,
    ) {
      for (const frame of resampler.process(samples)) {
        const probability = await model.process(frame);
        onFrame(frame, probability.isSpeech);
      }
    },
    close: () => model.release(),
  };
}
