import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

export interface EncodedImage {
  filename: string;
  mime: string;
  dataUrl: string;
}

export async function encodeImageFile(filePath: string): Promise<EncodedImage> {
  const buf = await readFile(filePath);
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `image too large (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB); max is ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
    );
  }
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const mime = EXT_TO_MIME[ext] ?? "image/jpeg";
  const b64 = buf.toString("base64");
  return {
    filename: basename(filePath),
    mime,
    dataUrl: `data:${mime};base64,${b64}`,
  };
}

export function isImagePath(path: string): boolean {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return ext in EXT_TO_MIME;
}
