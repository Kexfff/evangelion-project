import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { atomicWrite } from "./store";
import { providerKinds, type ProviderKind } from "../src/shared/schema";
const secretKinds = [...providerKinds, "telegram"] as const;
type SecretKind = ProviderKind | "telegram";

interface OSStorage {
  encryptString(text: string): Buffer;
  decryptString(bytes: Buffer): string;
}
const entrySchema = z.object({
  mode: z.enum(["os", "local"]),
  data: z.string(),
  iv: z.string().optional(),
  tag: z.string().optional(),
});
type Entry = z.infer<typeof entrySchema>;
export class CredentialVault {
  private entries: Partial<Record<SecretKind, Entry>> = {};
  private unlocked: Partial<Record<SecretKind, string>> = {};
  readonly file: string;
  private keyFile: string;
  get mode(): "encrypted" | "local-file" {
    return this.os &&
      Object.values(this.entries).every((entry) => entry?.mode === "os")
      ? "encrypted"
      : "local-file";
  }
  constructor(
    directory: string,
    private os: OSStorage | null,
  ) {
    this.file = path.join(directory, "credentials.json");
    this.keyFile = path.join(directory, "credentials.key");
    if (!existsSync(this.file)) return;
    const raw = JSON.parse(readFileSync(this.file, "utf8"));
    if (raw.version === 2)
      this.entries = z
        .partialRecord(z.enum(secretKinds), entrySchema)
        .parse(raw.entries);
    else {
      // Preserve sprint-1 OS-encrypted entries, including keys that are currently locked.
      const old = z.partialRecord(z.enum(providerKinds), z.string()).parse(raw);
      for (const kind of providerKinds)
        if (old[kind]) this.entries[kind] = { mode: "os", data: old[kind] };
    }
    for (const kind of secretKinds) {
      const entry = this.entries[kind];
      if (!entry) continue;
      try {
        if (entry.mode === "os") {
          if (os)
            this.unlocked[kind] = os.decryptString(
              Buffer.from(entry.data, "base64"),
            );
        } else {
          const decipher = createDecipheriv(
            "aes-256-gcm",
            this.localKey(false),
            Buffer.from(entry.iv!, "base64"),
          );
          decipher.setAuthTag(Buffer.from(entry.tag!, "base64"));
          this.unlocked[kind] = Buffer.concat([
            decipher.update(Buffer.from(entry.data, "base64")),
            decipher.final(),
          ]).toString("utf8");
        }
      } catch {
        /* Keep the original ciphertext; never silently delete a locked key. */
      }
    }
  }
  private localKey(create: boolean) {
    if (!existsSync(this.keyFile) && create)
      writeFileSync(this.keyFile, randomBytes(32), { mode: 0o600, flag: "wx" });
    const key = readFileSync(this.keyFile);
    if (key.length !== 32)
      throw new Error(
        "Local credential key is invalid. Re-enter the affected API key.",
      );
    if (process.platform !== "win32") chmodSync(this.keyFile, 0o600);
    return key;
  }
  has(kind: SecretKind) {
    return !!this.entries[kind];
  }
  get(kind: SecretKind) {
    if (this.entries[kind] && !this.unlocked[kind])
      throw new Error(
        `The saved ${kind} key is locked. Unlock your OS keyring or re-enter this key in ${kind === "telegram" ? "Plugins & MCP" : "Providers"}.`,
      );
    return this.unlocked[kind] ?? "";
  }
  save(incoming: Partial<Record<SecretKind, string>>) {
    const next = { ...this.entries };
    for (const kind of secretKinds) {
      const value = incoming[kind];
      if (value === undefined) continue;
      if (!value) {
        delete next[kind];
        continue;
      }
      if (this.os)
        next[kind] = {
          mode: "os",
          data: this.os.encryptString(value).toString("base64"),
        };
      else {
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", this.localKey(true), iv);
        next[kind] = {
          mode: "local",
          iv: iv.toString("base64"),
          tag: "",
          data: Buffer.concat([
            cipher.update(value, "utf8"),
            cipher.final(),
          ]).toString("base64"),
        };
        next[kind]!.tag = cipher.getAuthTag().toString("base64");
      }
    }
    atomicWrite(this.file, JSON.stringify({ version: 2, entries: next }));
    this.entries = next;
    Object.assign(this.unlocked, incoming);
  }
}
