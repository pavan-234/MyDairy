import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";

const uploadDirectory = path.resolve(
  process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads")
);

export async function ensureImageStorage() {
  await mkdir(uploadDirectory, { recursive: true });
}

export function imageFilePath(id) {
  if (!/^[\da-f-]{36}$/.test(id)) {
    throw new Error("Invalid image identifier");
  }
  return path.join(uploadDirectory, `${id}.webp`);
}

export async function deleteStoredImage(id) {
  try {
    await unlink(imageFilePath(id));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
