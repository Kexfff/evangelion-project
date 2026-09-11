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
