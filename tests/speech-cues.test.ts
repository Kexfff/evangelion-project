import { describe, expect, it } from "vitest";
import { visibleAssistantText } from "../src/shared/speech-cues";
import { SentenceBuffer, LineBuffer } from "../src/audio/sentences";
import { listHistory } from "../src/shared/history";
import type { Message } from "../src/shared/schema";

describe("speech-only angle-bracket cues", () => {
  it.each([
    ["<whispering> Hello there.", "Hello there."],
    ["Hello <speaking softly> there.", "Hello there."],
    ["<laughing><whispering>Hi!</whispering>", "Hi!"],
    ["<шёпотом> Привет!", "Привет!"],
    ["<whispering>", ""],
    ["2 < 3 and 5 > 4; <3", "2 < 3 and 5 > 4; <3"],
    [
      "<https://example.com> <user@example.com>",
      "<https://example.com> <user@example.com>",
    ],
    [
      "Use `<whispering>` or ```html\n<div>literal</div>\n```",
      "Use `<whispering>` or ```html\n<div>literal</div>\n```",
    ],
    ["~~~xml\n<tag>literal</tag>\n~~~", "~~~xml\n<tag>literal</tag>\n~~~"],
    ["\\<whispering> is escaped", "\\<whispering> is escaped"],
    ["An unfinished <whisp", "An unfinished <whisp"],
    ['<tag attr="value">', '<tag attr="value">'],
  ])("projects %s without modifying its input", (raw, expected) => {
    expect(visibleAssistantText(raw)).toBe(expected);
  });
  it("does not flash partial cues across arbitrary token boundaries", () => {
    const cue = "<speaking softly>";
    for (let n = 1; n <= cue.length; n++)
      expect(visibleAssistantText(cue.slice(0, n), true)).toBe("");
    expect(visibleAssistantText("Hello <whisp", true)).toBe("Hello ");
    expect(visibleAssistantText("Use `<whisp", true)).toBe("Use `<whisp");
    expect(visibleAssistantText("<https://example.com", true)).toBe(
      "<https://example.com",
    );
  });
  it("keeps the original cues in sentence and line speech chunks", () => {
    for (const buffer of [new SentenceBuffer(), new LineBuffer()]) {
      expect(buffer.push("<whis")).toEqual([]);
      const chunks = buffer.push("pering> Hello there.", true);
      expect(chunks.join(" ")).toBe("<whispering> Hello there.");
    }
  });
  it("cleans assistant archive previews without changing saved replies or user text", () => {
    const messages: Message[] = [
      {
        id: "u",
        characterId: "eva",
        sessionId: "s",
        role: "user",
        content: "Please use <whispering>",
        createdAt: "2026-10-21T10:00:00Z",
      },
      {
        id: "a",
        characterId: "eva",
        sessionId: "s",
        role: "assistant",
        content: "<whispering> Hello.",
        createdAt: "2026-10-21T10:00:01Z",
      },
    ];
    const page = listHistory(messages, "s", {
      characterId: "eva",
      search: "",
      channel: "all",
      offset: 0,
    });
    expect(page.sessions[0]).toMatchObject({
      title: "Please use <whispering>",
      preview: "Hello.",
    });
    expect(messages[1].content).toBe("<whispering> Hello.");
  });
});
