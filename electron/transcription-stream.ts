/** Streaming /audio/transcriptions response. Audio upload is still a completed utterance. */
export async function consumeTranscription(
  response: Response,
  onText: (text: string) => void,
) {
  if (!response.body) throw new Error("Transcription stream was empty.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let pending = "",
    text = "",
    complete = false;
  function parse(line: string) {
    if (!line.startsWith("data:")) return;
    const value = line.slice(5).trim();
    if (!value) return;
    if (value === "[DONE]") {
      complete = true;
      return;
    }
    const data = JSON.parse(value);
    if (data.error || data.type === "error")
      throw new Error("Transcription provider reported a streaming error.");
    if (
      data.type === "transcript.text.delta" &&
      typeof data.delta === "string"
    ) {
      text += data.delta;
      onText(text);
    } else if (
      data.type === "transcription.partial" &&
      typeof data.text === "string"
    ) {
      // Qwen-compatible wrappers can revise the entire provisional transcript.
      text = data.text;
      onText(text);
    } else if (
      ["transcript.text.done", "transcription.done"].includes(data.type) &&
      typeof data.text === "string"
    ) {
      text = data.text;
      complete = true;
      onText(text);
    }
    if (text.length > 50000)
      throw new Error("Transcription exceeds the text limit.");
  }
  try {
    while (!complete) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      if (pending.length > 100000)
        throw new Error("Transcription stream frame is too large.");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (complete) break;
        parse(line.trimEnd());
      }
      if (done) {
        if (!complete && pending.trim()) parse(pending);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!complete)
    throw new Error(
      "Transcription stream ended early. Nothing was sent to chat.",
    );
  if (!text.trim()) throw new Error("No speech was recognized.");
  return text.trim();
}
