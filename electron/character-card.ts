import { z } from "zod";
import { characterSchema } from "../src/shared/schema";
export const characterCardSchema = z.object({
  format: z.literal("evangelion-character"),
  version: z.literal(1),
  character: characterSchema.omit({ id: true, avatar: true }),
  avatar: z.object({
    kind: z.enum(["builtin", "embedded"]),
    vrm: z
      .string()
      .max(280 * 1024 * 1024)
      .optional(),
  }),
});
export function cardAvatar(raw: z.infer<typeof characterCardSchema>) {
  if (raw.avatar.kind === "builtin") return undefined;
  if (!raw.avatar.vrm || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.avatar.vrm))
    throw new Error("Card is missing its VRM avatar.");
  const bytes = Buffer.from(raw.avatar.vrm, "base64");
  if (
    bytes.length > 200 * 1024 * 1024 ||
    bytes.length < 12 ||
    bytes.subarray(0, 4).toString() !== "glTF" ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    throw new Error("Invalid embedded VRM. Nothing was imported.");
  return bytes;
}
