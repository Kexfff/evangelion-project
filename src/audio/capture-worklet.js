class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
    this.finishing = false;
    this.port.onmessage = (event) => {
      if (event.data === "finish") {
        this.finishing = true;
        if (this.offset)
          this.port.postMessage(this.buffer.slice(0, this.offset));
        this.offset = 0;
        this.port.postMessage("finished");
      }
    };
  }
  process(inputs) {
    if (this.finishing) return true;
    const input = inputs[0]?.[0];
    if (input)
      for (const sample of input) {
        this.buffer[this.offset++] = sample;
        if (this.offset === this.buffer.length) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(2048);
          this.offset = 0;
        }
      }
    return true;
  }
}
registerProcessor("eva-capture", CaptureProcessor);
