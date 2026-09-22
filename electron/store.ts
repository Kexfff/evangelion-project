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
  sessions: z.record(z.string(), z.string()),
  automation: automationSchema.default({ states: {}, tasks: [], activity: [] }),
  telegram: telegramStateSchema.default(() => telegramStateSchema.parse({})),
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
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, "companion.json");
    if (existsSync(this.file)) {
      // Refuse to overwrite a corrupt database; its previous version remains in .bak.
      this.data = databaseSchema.parse(
        JSON.parse(readFileSync(this.file, "utf8")),
      );
    } else {
      this.data = {
        version: 1,
        settings: structuredClone(defaultSettings),
        facts: [],
        messages: [],
        sessions: { eva: randomUUID() },
        automation: { states: {}, tasks: [], activity: [] },
        telegram: telegramStateSchema.parse({}),
      };
      this.save();
    }
  }
  update(mutate: (draft: Database) => void) {
    const draft = structuredClone(this.data);
    mutate(draft);
    const next = databaseSchema.parse(draft);
    this.save(next);
    this.data = next;
  }
  private save(data = this.data) {
    if (existsSync(this.file)) copyFileSync(this.file, `${this.file}.bak`);
    atomicWrite(this.file, JSON.stringify(data, null, 2));
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
