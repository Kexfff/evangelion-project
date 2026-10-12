/** Byte signatures keep callers from labeling a WAV reply as MP3. */
export function isWaveAudio(bytes: Uint8Array) {
  return (
    bytes.length >= 12 &&
    bytes[0] === 82 &&
    bytes[1] === 73 &&
    bytes[2] === 70 &&
    bytes[3] === 70 &&
    bytes[8] === 87 &&
    bytes[9] === 65 &&
    bytes[10] === 86 &&
    bytes[11] === 69
  );
}
