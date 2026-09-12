/** Retains incomplete sentences across arbitrary LLM token boundaries. */
export class SentenceBuffer {
  private pending = "";
  push(text: string, flush = false): string[] {
    this.pending += text;
    const sentences: string[] = [];
    const boundary = /[.!?。！？](?:["'”’)]*)?(?:\s+|(?=[\u3000-\u9fff]))|\n+/g;
    let match: RegExpExecArray | null;
    let offset = 0;
    while ((match = boundary.exec(this.pending))) {
      const end = match.index + match[0].length;
      const sentence = this.pending.slice(offset, end).trim();
      if (/\b(?:Mr|Mrs|Ms|Dr|Prof|St|e\.g|i\.e)\.$/i.test(sentence)) continue;
      if (sentence) sentences.push(sentence);
      offset = end;
    }
    this.pending = this.pending.slice(offset);
    // Long punctuation-free output must not delay speech indefinitely.
    while (this.pending.length > 240) {
      let at = this.pending.lastIndexOf(" ", 240);
      if (at < 80) at = 240;
      sentences.push(this.pending.slice(0, at).trim());
      this.pending = this.pending.slice(at).trimStart();
    }
    if (flush && this.pending.trim()) {
      sentences.push(this.pending.trim());
      this.pending = "";
    }
    return sentences;
  }
}

/** Only explicit newlines end a chunk; visual wrapping and punctuation do not. */
export class LineBuffer {
  private pending = "";
  push(text: string, flush = false): string[] {
    this.pending += text;
    const lines = this.pending.split(/\r\n|[\r\n]/);
    this.pending = lines.pop()!;
    if (flush) {
      lines.push(this.pending);
      this.pending = "";
    }
    const chunks: string[] = [];
    const splitLongLine = (line: string) => {
      // Match the speech IPC limit without applying the sentence buffer's
      // short 240-character fallback (which would defeat line mode).
      while (line.length > 12000) {
        let at = line.lastIndexOf(" ", 12000);
        if (at < 6000) at = 12000;
        const chunk = line.slice(0, at).trim();
        if (chunk) chunks.push(chunk);
        line = line.slice(at).trimStart();
      }
      return line;
    };
    for (const line of lines) {
      const tail = splitLongLine(line).trim();
      if (tail) chunks.push(tail);
    }
    this.pending = splitLongLine(this.pending);
    return chunks;
  }
}

export function createSpeechBuffer(mode: "sentence" | "line" = "sentence") {
  return mode === "line" ? new LineBuffer() : new SentenceBuffer();
}
