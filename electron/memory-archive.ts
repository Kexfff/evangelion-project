import {
  randomBytes,
  scrypt as scryptCallback,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { gzipSync, gunzipSync } from "node:zlib";
const scrypt = promisify(scryptCallback);
export const archivePassword = z.string().min(10).max(256);
const envelope = z.object({
  format: z.literal("eva-encrypted-memory"),
  version: z.literal(1),
  compression: z.literal("gzip"),
  salt: z.string().regex(/^[a-f0-9]{32}$/),
  iv: z.string().regex(/^[a-f0-9]{24}$/),
  tag: z.string().regex(/^[a-f0-9]{32}$/),
  ciphertext: z
    .string()
    .max(256 * 1024 * 1024)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export async function encryptArchive(plaintext: string, password: string) {
  archivePassword.parse(password);
  if (Buffer.byteLength(plaintext) > 192 * 1024 * 1024)
    throw new Error("Archive exceeds the 192 MB expanded limit.");
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const key = (await scrypt(password, salt, 32)) as Buffer;
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from("eva-encrypted-memory:1:gzip"));
    const ciphertext = Buffer.concat([
      cipher.update(gzipSync(plaintext)),
      cipher.final(),
    ]);
    return JSON.stringify({
      format: "eva-encrypted-memory",
      version: 1,
      compression: "gzip",
      salt: salt.toString("hex"),
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      ciphertext: ciphertext.toString("base64"),
    });
  } finally {
    key.fill(0);
  }
}
export async function decryptArchive(
  raw: unknown,
  password?: string,
): Promise<unknown> {
  if (!raw || typeof raw !== "object" || !("format" in raw)) return raw;
  if (!password)
    throw new Error("Enter the archive passphrase before importing.");
  const e = envelope.parse(raw),
    key = (await scrypt(
      archivePassword.parse(password),
      Buffer.from(e.salt, "hex"),
      32,
    )) as Buffer;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(e.iv, "hex"),
    );
    decipher.setAAD(Buffer.from("eva-encrypted-memory:1:gzip"));
    decipher.setAuthTag(Buffer.from(e.tag, "hex"));
    const compressed = Buffer.concat([
      decipher.update(Buffer.from(e.ciphertext, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(
      gunzipSync(compressed, { maxOutputLength: 192 * 1024 * 1024 }).toString(
        "utf8",
      ),
    );
  } catch {
    throw new Error(
      "Wrong passphrase or damaged archive. Nothing was imported.",
    );
  } finally {
    key.fill(0);
  }
}
