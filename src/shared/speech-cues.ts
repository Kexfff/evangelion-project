/** Display projection only: keep the original reply for storage and TTS.
 * Plain <whispering> / <speaking softly> cues outside code are speech-only.
 * URLs, emails, comparisons, escaped brackets and code stay literal.
 */
export function visibleAssistantText(text: string, streaming = false): string {
  let result = "";
  for (let at = 0; at < text.length;) {
    if (text[at] === "\\" && at + 1 < text.length) {
      result += text.slice(at, at + 2);
      at += 2;
      continue;
    }
    if (text[at] === "`" || text.startsWith("~~~", at)) {
      const char = text[at];
      let end = at + 1;
      while (text[end] === char) end++;
      const marker = text.slice(at, end);
      const close = text.indexOf(marker, end);
      const stop = close < 0 ? text.length : close + marker.length;
      result += text.slice(at, stop);
      at = stop;
      continue;
    }
    if (text[at] === "<") {
      const tail = text.slice(at);
      const cue = /^<\/?[\p{L}][\p{L}\p{N} _.,!?'’():-]{0,159}>/u.exec(tail);
      if (cue) {
        at += cue[0].length;
        if (!result || /\s$/.test(result))
          while (text[at] === " " || text[at] === "\t") at++;
        continue;
      }
      // Don't flash an incomplete cue while its closing bracket is arriving.
      if (
        streaming &&
        /^<\/?(?:[\p{L}][\p{L}\p{N} _.,!?'’():-]{0,159})?$/u.test(tail)
      )
        break;
    }
    result += text[at++];
  }
  return result;
}
