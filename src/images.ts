import {
  imageAttachmentSchema,
  MAX_IMAGE_BYTES,
  type ImageAttachment,
} from "./shared/images";

export async function readImage(file: File): Promise<ImageAttachment> {
  if (!file.size || file.size > MAX_IMAGE_BYTES)
    throw new Error(`${file.name}: images must be between 1 byte and 2 MB.`);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onabort = () =>
      reject(new Error(`Reading ${file.name} was cancelled.`));
    reader.readAsDataURL(file);
  });
  const result = imageAttachmentSchema.safeParse({ name: file.name, dataUrl });
  if (!result.success)
    throw new Error(
      `${file.name}: use a PNG, JPEG, WebP or GIF image up to 2 MB.`,
    );
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () =>
      reject(new Error(`${file.name}: this image could not be decoded.`));
    image.src = dataUrl;
  });
  return result.data;
}
