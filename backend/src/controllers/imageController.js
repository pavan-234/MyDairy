import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import sharp from "sharp";
import DiaryEntry from "../models/DiaryEntry.js";
import {
  deleteStoredImage,
  ensureImageStorage,
  imageFilePath,
} from "../services/imageStorage.js";
import { maxImageSize } from "../middleware/imageUpload.js";
import { invalidateUserReadCache } from "../services/readCache.js";
import {
  clearEntryUnlockCookie,
  hasValidEntryUnlock,
} from "../services/entryUnlock.js";

const maxImagesPerEntry = 5;
const maxImageNameLength = 180;
const acceptedFormats = new Map([
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

function safeOriginalName(value) {
  const baseName = path.basename(
    String(value || "image").replaceAll("\\", "/")
  );
  const safeName = baseName
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maxImageNameLength);
  return safeName || "image";
}

export async function loadOwnedEntry(req, res, next) {
  const entry = await DiaryEntry.findOne({
    _id: req.params.id,
    userId: req.authUser._id,
  }).select("+unlockVersion");
  if (!entry) {
    return res.status(404).json({ message: "Diary entry not found" });
  }
  req.diaryEntry = entry;
  next();
}

export async function loadActiveOwnedEntry(req, res, next) {
  const entry = await DiaryEntry.findOne({
    _id: req.params.id,
    userId: req.authUser._id,
    deletedAt: null,
  }).select("+unlockVersion");
  if (!entry) {
    return res.status(404).json({ message: "Diary entry not found" });
  }
  req.diaryEntry = entry;
  next();
}

export function requireEntryUnlocked(req, res, next) {
  const entry = req.diaryEntry;
  if (entry.isLocked && !hasValidEntryUnlock(req, entry)) {
    clearEntryUnlockCookie(res);
    res.set("Cache-Control", "private, no-store");
    return res.status(423).json({
      message: "This entry is locked. Verify your password to unlock it.",
    });
  }
  next();
}

function ownedEntry(req) {
  return req.diaryEntry;
}

export async function uploadEntryImage(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: "Choose an image to upload" });
  }

  let metadata;
  let output;
  try {
    const image = sharp(req.file.buffer, {
      failOn: "error",
      limitInputPixels: 40_000_000,
    });
    metadata = await image.metadata();
    if (!acceptedFormats.has(metadata.format)) {
      return res.status(400).json({
        message: "Only JPEG, PNG, and WebP images are supported",
      });
    }
    if (req.file.mimetype !== acceptedFormats.get(metadata.format)) {
      return res.status(400).json({
        message: "Image content does not match its declared MIME type",
      });
    }
    output = await image
      .rotate()
      .resize({
        width: 2560,
        height: 2560,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    if (
      error instanceof Error &&
      /input image|unsupported|corrupt|format/i.test(error.message)
    ) {
      return res
        .status(400)
        .json({ message: "Uploaded file is not a valid image" });
    }
    throw error;
  }
  if (output.data.length > maxImageSize) {
    return res
      .status(413)
      .json({ message: "Processed image exceeds the 5 MB limit" });
  }

  await ensureImageStorage();
  const id = randomUUID();
  const attachment = {
    id,
    originalName: safeOriginalName(req.file.originalname),
    mimeType: "image/webp",
    size: output.data.length,
    width: output.info.width,
    height: output.info.height,
    createdAt: new Date(),
  };
  await writeFile(imageFilePath(id), output.data, { flag: "wx", mode: 0o600 });
  try {
    const updatedEntry = await DiaryEntry.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.authUser._id,
        deletedAt: null,
        "images.4": { $exists: false },
      },
      { $push: { images: attachment } },
      { new: true, runValidators: true }
    );
    if (!updatedEntry) {
      await deleteStoredImage(id);
      const stillOwned = await DiaryEntry.exists({
        _id: req.params.id,
        userId: req.authUser._id,
        deletedAt: null,
      });
      if (!stillOwned) {
        return res.status(404).json({ message: "Diary entry not found" });
      }
      return res.status(400).json({
        message: `An entry can have at most ${maxImagesPerEntry} images`,
      });
    }
    await invalidateUserReadCache(req.authUser._id);
  } catch (error) {
    await deleteStoredImage(id);
    throw error;
  }
  res.status(201).json({ attachment });
}

export async function getEntryImage(req, res) {
  const entry = ownedEntry(req);
  const attachment = entry.images.find(
    (image) => image.id === req.params.imageId
  );
  if (!attachment) {
    return res.status(404).json({ message: "Image not found" });
  }

  res.set({
    "Content-Type": attachment.mimeType,
    "Content-Length": String(attachment.size),
    "Content-Disposition": "inline",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  try {
    await pipeline(createReadStream(imageFilePath(attachment.id)), res);
  } catch (error) {
    if (error.code === "ENOENT") {
      if (!res.headersSent) {
        res.status(404).json({ message: "Image file is unavailable" });
      }
      return;
    }
    throw error;
  }
}

export async function deleteEntryImage(req, res) {
  const entry = ownedEntry(req);
  const attachment = entry.images.find(
    (image) => image.id === req.params.imageId
  );
  if (!attachment) return res.status(404).json({ message: "Image not found" });

  const updatedEntry = await DiaryEntry.findOneAndUpdate(
    {
      _id: req.params.id,
      userId: req.authUser._id,
      deletedAt: null,
      "images.id": req.params.imageId,
    },
    { $pull: { images: { id: req.params.imageId } } },
    { new: true }
  );
  if (!updatedEntry) {
    return res.status(404).json({ message: "Image not found" });
  }
  await invalidateUserReadCache(req.authUser._id);
  await deleteStoredImage(req.params.imageId);
  res.json({ message: "Image deleted successfully" });
}

export async function deleteEntryImages(entry) {
  for (const image of entry.images || []) {
    await deleteStoredImage(image.id);
  }
}
