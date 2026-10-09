import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Database } from "./store";

/** Only generated content hashes are accepted; imported archives still require validated inline images. */
export class AttachmentStore {
  readonly directory: string;
  constructor(directory: string) {
    this.directory = path.join(directory, "attachments");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }
  pack(data: Database) {
    return {
      ...data,
      messages: data.messages.map((m) => ({
        ...m,
        ...(m.images
          ? {
              images: m.images.map((image) => {
                const id = createHash("sha256")
                  .update(image.dataUrl)
                  .digest("hex");
                const file = path.join(this.directory, id);
                if (!existsSync(file))
                  writeFileSync(file, image.dataUrl, {
                    mode: 0o600,
                    flag: "wx",
                  });
                return { name: image.name, dataUrl: `eva-attachment:${id}` };
              }),
            }
          : {}),
      })),
    };
  }
  unpack(raw: unknown): unknown {
    if (
      !raw ||
      typeof raw !== "object" ||
      !("messages" in raw) ||
      !Array.isArray(raw.messages)
    )
      return raw;
    for (const m of raw.messages)
      for (const image of m?.images ?? []) {
        if (typeof image?.dataUrl !== "string") continue;
        const match = /^eva-attachment:([a-f0-9]{64})$/.exec(image.dataUrl);
        if (!match) continue;
        const data = readFileSync(path.join(this.directory, match[1]), "utf8");
        if (createHash("sha256").update(data).digest("hex") !== match[1])
          throw new Error(
            "Attachment integrity check failed. Restore the profile from a backup.",
          );
        image.dataUrl = data;
      }
    return raw;
  }
  prune(data: Database) {
    const keep = new Set(
      data.messages.flatMap((m) =>
        (m.images ?? []).map((i) =>
          createHash("sha256").update(i.dataUrl).digest("hex"),
        ),
      ),
    );
    let removed = 0;
    for (const id of readdirSync(this.directory))
      if (/^[a-f0-9]{64}$/.test(id) && !keep.has(id)) {
        unlinkSync(path.join(this.directory, id));
        removed++;
      }
    return removed;
  }
}
