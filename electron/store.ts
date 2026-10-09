import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { automationSchema } from "../src/shared/autonomy";
import { telegramStateSchema } from "../src/shared/plugins";
import { mcpStateSchema } from "../src/shared/mcp";
import { minecraftStateSchema } from "../src/shared/minecraft";
import { historyTotals } from "../src/shared/history";
import { MemoryLibrary, memoryDocuments } from "./memory-library";
import { AttachmentStore } from "./attachments";
import { summarySchema, summaryHash } from "./consolidation";
import {
  defaultSettings,
  settingsSchema,
  factSchema,
  messageSchema,
  type Settings,
  type Snapshot,
} from "../src/shared/schema";

const databaseSchema = z.object({
  version: z.literal(1),
  settings: settingsSchema,
  facts: z.array(factSchema),
  messages: z.array(messageSchema),
  summaries: z.array(summarySchema).default([]),
  sessions: z.record(z.string(), z.string()),
  automation: automationSchema.default({ states: {}, tasks: [], activity: [] }),
  telegram: telegramStateSchema.default(() => telegramStateSchema.parse({})),
  mcp: mcpStateSchema.default(() => mcpStateSchema.parse({})),
  minecraft: minecraftStateSchema.default(() => minecraftStateSchema.parse({})),
});
export type Database = z.infer<typeof databaseSchema>;
export function atomicWrite(file: string, data: string) {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, data, { mode: 0o600 });
  renameSync(temporary, file);
}
export class Store {
  data: Database;
  readonly file: string;
  readonly library: MemoryLibrary;
  readonly attachments: AttachmentStore;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, "companion.json");
    this.attachments = new AttachmentStore(directory);
    this.library = new MemoryLibrary(path.join(directory, "memory.sqlite"));
    if (existsSync(this.file)) {
      // Refuse to overwrite a corrupt database; its previous version remains in .bak.
      this.data = databaseSchema.parse(
        this.attachments.unpack(JSON.parse(readFileSync(this.file, "utf8"))),
      );
    } else {
      this.data = {
        version: 1,
        settings: structuredClone(defaultSettings),
        facts: [],
        messages: [],
        summaries: [],
        sessions: { eva: randomUUID() },
        automation: { states: {}, tasks: [], activity: [] },
        telegram: telegramStateSchema.parse({}),
        mcp: mcpStateSchema.parse({}),
        minecraft: minecraftStateSchema.parse({}),
      };
      this.save();
    }
    this.library.sync(memoryDocuments(this.data));
  }
  update(mutate: (draft: Database) => void) {
    const draft = structuredClone(this.data);
    mutate(draft);
    // Derived summaries never outlive or detach from the exact source messages.
    const messages = new Map(draft.messages.map((m) => [m.id, m]));
    draft.summaries = draft.summaries.filter((s) => {
      const sources = s.sourceIds.map((id) => messages.get(id));
      return (
        sources.every((m) => m?.characterId === s.characterId) &&
        summaryHash(sources as Database["messages"]) === s.sourceHash
      );
    });
    const next = databaseSchema.parse(draft);
    this.save(next);
    this.data = next;
    this.library.sync(memoryDocuments(next));
  }
  private save(data = this.data) {
    if (existsSync(this.file)) copyFileSync(this.file, `${this.file}.bak`);
    atomicWrite(
      this.file,
      JSON.stringify(this.attachments.pack(data), null, 2),
    );
  }
  /** Explicitly discard recoverable old data after a user-approved deletion. */
  purgeDeleted() {
    atomicWrite(
      `${this.file}.bak`,
      JSON.stringify(this.attachments.pack(this.data), null, 2),
    );
    const removed = this.attachments.prune(this.data);
    this.library.compact();
    return removed;
  }
  get characterId() {
    return this.data.settings.activeCharacterId;
  }
  get sessionId() {
    return this.data.sessions[this.characterId];
  }
  settings(settings: Settings) {
    this.update((d) => {
      d.settings = settings;
      for (const character of settings.characters)
        d.sessions[character.id] ??= randomUUID();
    });
  }
  snapshot(secretStorage: Snapshot["secretStorage"], busy: boolean): Snapshot {
    return {
      historyStats: historyTotals(this.data.messages, this.characterId),
      settings: this.data.settings,
      facts: this.data.facts.filter((f) => f.characterId === this.characterId),
      messages: this.data.messages
        .filter(
          (m) =>
            m.characterId === this.characterId &&
            m.sessionId === this.sessionId,
        )
        .slice(-200),
      sessionId: this.sessionId,
      secretStorage,
      busy,
    };
  }
}
