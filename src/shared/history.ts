import { z } from "zod";
import type { Message } from "./schema";

export const HISTORY_PAGE_SIZE = 20;
export const historyQuerySchema = z
  .object({
    characterId: z.string().min(1).max(100),
    search: z.string().trim().max(200).default(""),
    channel: z.enum(["all", "desktop", "telegram"]).default("all"),
    offset: z.number().int().min(0).max(100000).default(0),
  })
  .strict();
export const conversationQuerySchema = historyQuerySchema.extend({
  sessionId: z.string().max(100),
});
export const historyImageQuerySchema = z
  .object({
    characterId: z.string().min(1).max(100),
    sessionId: z.string().max(100),
    messageId: z.string().max(100),
    index: z.number().int().min(0).max(3),
  })
  .strict();
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type ConversationQuery = z.infer<typeof conversationQuerySchema>;
export type HistoryImageQuery = z.infer<typeof historyImageQuerySchema>;
export interface ConversationSummary {
  id: string;
  title: string;
  preview: string;
  firstAt: string;
  lastAt: string;
  count: number;
  matches: number;
  images: number;
  channels: ("desktop" | "telegram")[];
  current: boolean;
}
export interface HistoryPage {
  sessions: ConversationSummary[];
  total: number;
  totalSessions: number;
  totalMessages: number;
}
export interface HistoryTotals {
  conversations: number;
  messages: number;
  images: number;
}
export function historyTotals(
  messages: Message[],
  characterId: string,
): HistoryTotals {
  const sessions = new Set<string>();
  let count = 0;
  let images = 0;
  for (const message of messages) {
    if (message.characterId !== characterId) continue;
    sessions.add(message.sessionId);
    count++;
    images += message.images?.length ?? 0;
  }
  return { conversations: sessions.size, messages: count, images };
}
export type HistoryMessage = Omit<Message, "images"> & {
  images: { name: string }[];
};
export interface ConversationPage {
  messages: HistoryMessage[];
  total: number;
}

function matches(message: Message, query: HistoryQuery) {
  return (
    (query.channel === "all" ||
      (message.channel ?? "desktop") === query.channel) &&
    (!query.search ||
      `${message.content}\n${message.images?.map((i) => i.name).join("\n") ?? ""}`
        .toLocaleLowerCase()
        .includes(query.search.toLocaleLowerCase()))
  );
}
function chronological(a: Message, b: Message) {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}
const snippet = (m: Message) =>
  (
    m.content.trim() || (m.images?.length ? "Shared an image" : "Empty message")
  ).slice(0, 180);

// Pure, read-only queries shared by the desktop and browser preview. Never put
// the entire archive or inline image bytes in routine renderer snapshots.
export function listHistory(
  messages: Message[],
  currentSessionId: string,
  query: HistoryQuery,
): HistoryPage {
  const own = messages.filter((m) => m.characterId === query.characterId);
  const groups = new Map<string, Message[]>();
  for (const m of own) {
    const group = groups.get(m.sessionId) ?? [];
    group.push(m);
    groups.set(m.sessionId, group);
  }
  const sessions: ConversationSummary[] = [];
  for (const [id, group] of groups) {
    group.sort(chronological);
    const matching = group.filter((m) => matches(m, query));
    if (!matching.length) continue;
    sessions.push({
      id,
      title: snippet(group.find((m) => m.role === "user") ?? group[0]),
      preview: snippet(
        query.search ? matching[0] : matching[matching.length - 1],
      ),
      firstAt: group[0].createdAt,
      lastAt: group[group.length - 1].createdAt,
      count: group.length,
      matches: matching.length,
      images: group.reduce((sum, m) => sum + (m.images?.length ?? 0), 0),
      channels: [...new Set(group.map((m) => m.channel ?? "desktop"))],
      current: id === currentSessionId,
    });
  }
  sessions.sort(
    (a, b) =>
      Date.parse(b.lastAt) - Date.parse(a.lastAt) || a.id.localeCompare(b.id),
  );
  return {
    sessions: sessions.slice(query.offset, query.offset + HISTORY_PAGE_SIZE),
    total: sessions.length,
    totalSessions: groups.size,
    totalMessages: own.length,
  };
}
export function readConversation(
  messages: Message[],
  query: ConversationQuery,
): ConversationPage {
  const filtered = messages
    .filter(
      (m) =>
        m.characterId === query.characterId &&
        m.sessionId === query.sessionId &&
        matches(m, query),
    )
    .sort(chronological);
  return {
    messages: filtered
      .slice(query.offset, query.offset + HISTORY_PAGE_SIZE)
      .map(({ images, ...m }) => ({
        ...m,
        images: (images ?? []).map((i) => ({ name: i.name })),
      })),
    total: filtered.length,
  };
}
export function readHistoryImage(
  messages: Message[],
  query: HistoryImageQuery,
) {
  const image = messages.find(
    (m) =>
      m.characterId === query.characterId &&
      m.sessionId === query.sessionId &&
      m.id === query.messageId,
  )?.images?.[query.index];
  if (!image) throw new Error("This attachment is no longer available.");
  return image;
}
export function assertHistoryCharacter(requested: string, active: string) {
  if (requested !== active)
    throw new Error(
      "The active character changed. Reopen conversation history.",
    );
}
