import { z } from "zod";

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

// Shared by the renderer, IPC, database and archive validators. No remote URLs,
// SVG, file paths, or arbitrarily large payloads cross the attachment boundary.
export const imageAttachmentSchema = z.object({
  name: z.string().min(1).max(255),
  dataUrl: z
    .string()
    .max(4 * Math.ceil(MAX_IMAGE_BYTES / 3) + 30)
    .refine((url) => {
      const match =
        /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
          url,
        );
      if (!match || match[2].length % 4 !== 0) return false;
      const size =
        (match[2].length / 4) * 3 -
        (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
      if (!size || size > MAX_IMAGE_BYTES) return false;
      try {
        const header = atob(match[2].slice(0, 24));
        switch (match[1]) {
          case "png":
            return header.startsWith("\x89PNG\r\n\x1a\n");
          case "jpeg":
            return header.startsWith("\xff\xd8\xff");
          case "gif":
            return header.startsWith("GIF87a") || header.startsWith("GIF89a");
          case "webp":
            return header.startsWith("RIFF") && header.slice(8, 12) === "WEBP";
        }
      } catch {
        /* Invalid base64. */
      }
      return false;
    }, "Use a PNG, JPEG, WebP or GIF image up to 2 MB."),
});
export const attachmentsSchema = z.array(imageAttachmentSchema).max(MAX_IMAGES);
export type ImageAttachment = z.infer<typeof imageAttachmentSchema>;
export const outgoingMessageSchema = z
  .object({
    text: z.string().trim().max(8000),
    images: attachmentsSchema.default([]),
  })
  .refine(
    (m) => m.text.length > 0 || m.images.length > 0,
    "Add text or an image before sending.",
  );
