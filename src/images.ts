import {
  imageAttachmentSchema,
  type ImageAttachment,
} from "./shared/images";

export async function readImage(file: File): Promise<ImageAttachment> {
  if (
    !file.size ||
    file.size > 20 * 1024 * 1024 ||
    !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)
  )
    throw new Error(
      `${file.name}: choose a PNG, JPEG, WebP or GIF up to 20 MB.`,
    );
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onabort = () =>
      reject(new Error(`Reading ${file.name} was cancelled.`));
    reader.readAsDataURL(file);
  });
  const decoded = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`${file.name}: this image could not be decoded.`));
    image.src = dataUrl;
  });
  if (decoded.width * decoded.height > 80_000_000)
    throw new Error("Image dimensions are too large (80 megapixel maximum).");
  if (
    file.size <= 400 * 1024 &&
    Math.max(decoded.width, decoded.height) <= 1600
  )
    return imageAttachmentSchema.parse({ name: file.name, dataUrl });
  const scale = Math.min(1, 1600 / Math.max(decoded.width, decoded.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(decoded.width * scale));
  canvas.height = Math.max(1, Math.round(decoded.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image compression is unavailable.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
  return imageAttachmentSchema.parse({
    name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
    dataUrl: canvas.toDataURL("image/jpeg", 0.82),
  });
}
