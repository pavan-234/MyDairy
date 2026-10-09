import { createHash, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { createReadStream } from "node:fs";
import { stat as statFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { ZipArchive } from "archiver";
import mongoose from "mongoose";
import PDFDocument from "pdfkit";
import sanitizeHtml from "sanitize-html";
import sharp from "sharp";
import unzipper from "unzipper";
import BackupImport from "../models/BackupImport.js";
import DailyTask, {
  taskPriorities,
  taskRecurrences,
  taskStatuses,
} from "../models/DailyTask.js";
import DiaryEntry, { diaryMoods } from "../models/DiaryEntry.js";
import User from "../models/User.js";
import {
  deleteStoredImage,
  ensureImageStorage,
  imageFilePath,
} from "../services/imageStorage.js";
import { invalidateUserReadCache } from "../services/readCache.js";

const schemaVersion = 1;
const maxArchiveBytes = 100 * 1024 * 1024;
const maxExpandedBytes = 250 * 1024 * 1024;
const maxJsonBytes = 100 * 1024 * 1024;
const maxRecords = 10_000;
const maxAttachments = 50_000;
const maxAttachmentBytes = 5 * 1024 * 1024;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const entryFields = new Set([
  "backupId",
  "title",
  "content",
  "date",
  "formatting",
  "mood",
  "tags",
  "isFavorite",
  "isDraft",
  "isLocked",
  "deletedAt",
  "createdAt",
  "updatedAt",
  "images",
]);
const taskFields = new Set([
  "backupId",
  "text",
  "dueDate",
  "status",
  "priority",
  "recurrence",
  "recurrenceSeriesBackupId",
  "createdAt",
  "updatedAt",
]);
const attachmentFields = new Set([
  "backupId",
  "path",
  "originalName",
  "mimeType",
  "size",
  "width",
  "height",
  "createdAt",
  "sha256",
]);

class BackupError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyFields(value, fields, description) {
  if (!isObject(value)) {
    throw new BackupError(`${description} must be an object`);
  }
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) {
      throw new BackupError(`Unsupported ${description} field: ${field}`);
    }
  }
}

function validDate(value) {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function validTimestamp(value, name) {
  const parsed = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value
  ) {
    throw new BackupError(`${name} must be an ISO 8601 timestamp`);
  }
  return parsed;
}

function safeFilename(format) {
  const date = new Date().toISOString().slice(0, 10);
  return `mydiary-${format}-${date}.${format === "pdf" ? "pdf" : "zip"}`;
}

function setDownloadHeaders(res, type, filename) {
  res.set({
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
}

function normalizeEntry(entry, imageBackupIds = new Map()) {
  const value = entry.toObject();
  return {
    backupId: randomUUID(),
    title: value.title || "",
    content: value.content || "",
    date: value.date,
    formatting: value.formatting || {},
    mood: value.mood || "NEUTRAL",
    tags: value.tags || [],
    isFavorite: Boolean(value.isFavorite),
    isDraft: Boolean(value.isDraft),
    isLocked: value.isLocked === true,
    deletedAt: value.deletedAt ? value.deletedAt.toISOString() : null,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    images: (value.images || []).map((image) => {
      const backup = imageBackupIds.get(image.id);
      return {
        backupId: backup?.backupId,
        path: backup?.path,
        originalName: image.originalName,
        mimeType: image.mimeType,
        size: image.size,
        width: image.width,
        height: image.height,
        createdAt: image.createdAt.toISOString(),
        sha256: backup?.sha256,
      };
    }),
  };
}

function normalizeTask(task, recurrenceIds) {
  const dueDate = task.dueDate || task.date;
  const status = task.status || (task.completed ? "COMPLETED" : "TODO");
  const recurrence = task.recurrence || "NONE";
  const seriesId =
    recurrence === "NONE" ? undefined : task.recurrenceSeriesId?.toString();
  if (seriesId && !recurrenceIds.has(seriesId)) {
    recurrenceIds.set(seriesId, randomUUID());
  }
  return {
    backupId: randomUUID(),
    text: task.text,
    dueDate,
    status,
    priority: task.priority || "MEDIUM",
    recurrence,
    recurrenceSeriesBackupId: seriesId ? recurrenceIds.get(seriesId) : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function jsonBuffer(value) {
  return Buffer.from(JSON.stringify(value, null, 2));
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function waitForDrain(stream) {
  return once(stream, "drain");
}

function writeChunk(stream, chunk) {
  if (stream.write(chunk)) return Promise.resolve();
  return waitForDrain(stream);
}

async function appendBackupData(archive, user, includeTrash, includeLocked) {
  const dataStream = new PassThrough();
  archive.append(dataStream, { name: "data.json" });
  const counts = { entries: 0, tasks: 0, attachments: 0 };
  const recurrenceIds = new Map();
  const entryFilter = {
    userId: user._id,
    ...(includeTrash ? {} : { deletedAt: null }),
    ...(includeLocked ? {} : { isLocked: { $ne: true } }),
  };

  const produce = async () => {
    try {
      const profile = { email: user.email, displayName: user.displayName };
      await writeChunk(
        dataStream,
        `{"profile":${JSON.stringify(profile)},"entries":[`
      );
      let first = true;
      const entries = DiaryEntry.find(entryFilter).sort({ _id: 1 }).cursor();
      for await (const entry of entries) {
        const imageBackupIds = new Map();
        for (const image of entry.images || []) {
          const backupId = randomUUID();
          const storedPath = imageFilePath(image.id);
          const imageStat = await statFile(storedPath);
          if (imageStat.size !== image.size) {
            throw new Error(
              `Stored attachment ${image.id} has an unexpected size`
            );
          }
          const hash = await hashFile(storedPath);
          const archivePath = `attachments/${backupId}.webp`;
          archive.file(storedPath, { name: archivePath, store: true });
          imageBackupIds.set(image.id, {
            backupId,
            path: archivePath,
            sha256: hash,
          });
        }
        const value = normalizeEntry(entry, imageBackupIds);
        if (!first) await writeChunk(dataStream, ",");
        await writeChunk(dataStream, JSON.stringify(value));
        first = false;
        counts.entries += 1;
        counts.attachments += value.images.length;
      }

      await writeChunk(dataStream, '],"tasks":[');
      first = true;
      const tasks = DailyTask.find({ userId: user._id })
        .sort({ _id: 1 })
        .cursor();
      for await (const task of tasks) {
        if (!first) await writeChunk(dataStream, ",");
        await writeChunk(
          dataStream,
          JSON.stringify(normalizeTask(task, recurrenceIds))
        );
        first = false;
        counts.tasks += 1;
      }
      await writeChunk(dataStream, "]}");
      dataStream.end();
      return counts;
    } catch (error) {
      dataStream.destroy(error);
      throw error;
    }
  };

  const countsPromise = produce();
  return { countsPromise };
}

function beginZipResponse(req, res, next, format) {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  let responded = false;
  archive.on("error", (error) => {
    if (responded) return;
    responded = true;
    if (res.headersSent) res.destroy(error);
    else next(error);
  });
  archive.on("warning", (error) => {
    if (error.code !== "ENOENT") archive.emit("error", error);
  });
  res.on("close", () => {
    if (!res.writableEnded) archive.abort();
  });
  setDownloadHeaders(res, "application/zip", safeFilename(format));
  archive.pipe(res);
  return archive;
}

export async function exportBackup(req, res, next) {
  const isPost = req.method === "POST";
  const options = isPost ? req.body : req.query;
  const allowedFields = isPost
    ? new Set(["format", "includeTrash", "includeLocked", "currentPassword"])
    : new Set(["format", "includeTrash"]);
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => !allowedFields.has(key)) ||
    (!isPost && Object.keys(req.query).some((key) => !allowedFields.has(key)))
  ) {
    return res.status(400).json({ message: "Invalid export parameters" });
  }
  const format = options.format ?? "json";
  if (!["json", "csv", "pdf"].includes(format)) {
    return res
      .status(400)
      .json({ message: "format must be json, csv, or pdf" });
  }
  if (
    Object.values(options).some(
      (value) => typeof value !== "string" && typeof value !== "boolean"
    )
  ) {
    return res.status(400).json({ message: "Invalid export parameters" });
  }
  const includeTrashValue = options.includeTrash ?? (isPost ? true : "true");
  if (
    (isPost && typeof includeTrashValue !== "boolean") ||
    (!isPost && includeTrashValue !== "true" && includeTrashValue !== "false")
  ) {
    return res
      .status(400)
      .json({ message: "includeTrash must be true or false" });
  }
  const includeTrash = isPost
    ? includeTrashValue
    : includeTrashValue === "true";
  const includeLocked = isPost && options.includeLocked === true;
  if (
    (options.includeLocked !== undefined &&
      (typeof options.includeLocked !== "boolean" || !isPost)) ||
    (options.currentPassword !== undefined &&
      (typeof options.currentPassword !== "string" || !isPost)) ||
    (includeLocked && format !== "json") ||
    (includeLocked && !options.currentPassword) ||
    (!includeLocked && options.currentPassword !== undefined)
  ) {
    return res.status(400).json({
      message:
        "Including locked entries requires JSON format and current-password verification",
    });
  }
  const user = await User.findById(req.authUser._id).select(
    includeLocked ? "email displayName +passwordHash" : "email displayName"
  );
  if (!user)
    return res.status(401).json({ message: "Authentication required" });
  if (
    includeLocked &&
    !(await argon2.verify(user.passwordHash, options.currentPassword))
  ) {
    return res.status(401).json({ message: "Current password is incorrect" });
  }

  if (format === "pdf") {
    return exportPdf(user, includeTrash, res);
  }

  const archive = beginZipResponse(req, res, next, format);
  const backupId = randomUUID();
  try {
    if (format === "json") {
      const { countsPromise } = await appendBackupData(
        archive,
        user,
        includeTrash,
        includeLocked
      );
      const counts = await countsPromise;
      archive.append(
        jsonBuffer({
          format: "mydiary-backup",
          schemaVersion,
          backupId,
          createdAt: new Date().toISOString(),
          includesTrash: includeTrash,
          includesLocked: includeLocked,
          counts,
        }),
        { name: "manifest.json" }
      );
    } else {
      await appendCsvFiles(archive, user, includeTrash);
    }
    await archive.finalize();
  } catch (error) {
    if (!res.headersSent) next(error);
    else res.destroy(error);
  }
}

function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

async function appendCsvFiles(archive, user, includeTrash) {
  const entryStream = new PassThrough();
  const taskStream = new PassThrough();
  const attachmentStream = new PassThrough();
  archive.append(entryStream, { name: "entries.csv" });
  archive.append(taskStream, { name: "tasks.csv" });
  archive.append(attachmentStream, { name: "attachments.csv" });
  const counts = { entries: 0, tasks: 0, attachments: 0 };
  const recurrenceIds = new Map();
  const produce = async () => {
    await writeChunk(
      entryStream,
      "backup_id,title,content,date,mood,tags,is_favorite,is_draft,deleted_at,created_at,updated_at,attachment_ids\r\n"
    );
    await writeChunk(
      taskStream,
      "backup_id,text,due_date,status,priority,recurrence,recurrence_series_backup_id,created_at,updated_at\r\n"
    );
    await writeChunk(
      attachmentStream,
      "backup_id,path,original_name,mime_type,size,width,height,created_at,sha256\r\n"
    );
    const entries = DiaryEntry.find({
      userId: user._id,
      ...(includeTrash ? {} : { deletedAt: null }),
      isLocked: { $ne: true },
    })
      .sort({ _id: 1 })
      .cursor();
    for await (const entry of entries) {
      const entryValue = normalizeEntry(entry);
      const attachmentIds = [];
      for (const image of entry.images || []) {
        const backupId = randomUUID();
        const archivePath = `attachments/${backupId}.webp`;
        const imagePath = imageFilePath(image.id);
        const sha256 = await hashFile(imagePath);
        archive.file(imagePath, { name: archivePath, store: true });
        attachmentIds.push(backupId);
        await writeChunk(
          attachmentStream,
          `${[
            backupId,
            archivePath,
            image.originalName,
            image.mimeType,
            image.size,
            image.width,
            image.height,
            image.createdAt.toISOString(),
            sha256,
          ]
            .map(csvCell)
            .join(",")}\r\n`
        );
        counts.attachments += 1;
      }
      const values = [
        entryValue.backupId,
        entryValue.title,
        entryValue.content,
        entryValue.date,
        entryValue.mood,
        JSON.stringify(entryValue.tags),
        entryValue.isFavorite,
        entryValue.isDraft,
        entryValue.deletedAt,
        entryValue.createdAt,
        entryValue.updatedAt,
        JSON.stringify(attachmentIds),
      ];
      await writeChunk(entryStream, `${values.map(csvCell).join(",")}\r\n`);
      counts.entries += 1;
    }
    const tasks = DailyTask.find({ userId: user._id })
      .sort({ _id: 1 })
      .cursor();
    for await (const task of tasks) {
      const value = normalizeTask(task, recurrenceIds);
      await writeChunk(
        taskStream,
        `${[
          value.backupId,
          value.text,
          value.dueDate,
          value.status,
          value.priority,
          value.recurrence,
          value.recurrenceSeriesBackupId,
          value.createdAt,
          value.updatedAt,
        ]
          .map(csvCell)
          .join(",")}\r\n`
      );
      counts.tasks += 1;
    }
    entryStream.end();
    taskStream.end();
    attachmentStream.end();
    archive.append(
      jsonBuffer({
        format: "mydiary-csv-export",
        schemaVersion,
        createdAt: new Date().toISOString(),
        includesTrash: includeTrash,
        includesLocked: false,
        counts,
        encoding: "UTF-8",
      }),
      { name: "manifest.json" }
    );
  };
  await produce();
}

function plainContent(value) {
  return sanitizeHtml(value || "", {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(/&nbsp;|&#160;/gi, " ")
    .trim();
}

function writePdfSectionTitle(doc, title) {
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(16).text(title);
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10);
}

function exportPdf(user, includeTrash, res) {
  setDownloadHeaders(res, "application/pdf", safeFilename("pdf"));
  const doc = new PDFDocument({ autoFirstPage: true, margin: 52 });
  doc.on("error", (error) => res.destroy(error));
  res.on("close", () => {
    if (!res.writableEnded) doc.end();
  });
  doc.pipe(res);
  doc.font("Helvetica-Bold").fontSize(24).text("MyDiary Export");
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(10);
  doc.text(`Account: ${user.email}`);
  doc.text(`Exported: ${new Date().toISOString()}`);
  doc.text(`Includes Trash: ${includeTrash ? "Yes" : "No"}`);
  doc.moveDown();

  const entryCursor = DiaryEntry.find({
    userId: user._id,
    ...(includeTrash ? {} : { deletedAt: null }),
    isLocked: { $ne: true },
  })
    .sort({ date: 1, createdAt: 1 })
    .cursor();
  const taskCursor = DailyTask.find({ userId: user._id })
    .sort({ dueDate: 1, date: 1, createdAt: 1 })
    .cursor();

  void (async () => {
    try {
      writePdfSectionTitle(doc, "Diary entries");
      let entryCount = 0;
      for await (const entry of entryCursor) {
        if (entryCount > 0) doc.moveDown();
        doc.font("Helvetica-Bold").fontSize(12);
        doc.text(`${entry.date} · ${entry.title || "Untitled entry"}`);
        doc.font("Helvetica").fontSize(9);
        const details = [
          entry.mood || "NEUTRAL",
          ...(entry.tags || []).map((tag) => `#${tag}`),
          entry.isFavorite ? "Favorite" : "",
          entry.isDraft ? "Draft" : "",
          entry.deletedAt
            ? `In Trash since ${entry.deletedAt.toISOString()}`
            : "",
        ].filter(Boolean);
        if (details.length) doc.text(details.join(" · "));
        const content = plainContent(entry.content);
        if (content) doc.text(content);
        for (const image of entry.images || []) {
          doc.fontSize(8).text(`Attachment: ${image.originalName}`);
        }
        doc.fontSize(8).fillColor("#555555");
        doc.text(
          `Created ${entry.createdAt.toISOString()} · Updated ${entry.updatedAt.toISOString()}`
        );
        doc.fillColor("#000000");
        entryCount += 1;
      }
      writePdfSectionTitle(doc, `Tasks`);
      let taskCount = 0;
      for await (const task of taskCursor) {
        const status = task.status || (task.completed ? "COMPLETED" : "TODO");
        doc.font("Helvetica-Bold").fontSize(10).text(task.text);
        doc.font("Helvetica").fontSize(9);
        doc.text(
          `${task.dueDate || task.date} · ${status} · ${task.priority || "MEDIUM"} · ${task.recurrence || "NONE"}`
        );
        taskCount += 1;
      }
      if (!entryCount && !taskCount) {
        doc.text("No diary entries or tasks to export.");
      }
      doc.end();
    } catch (error) {
      doc.destroy(error);
      res.destroy(error);
    }
  })();
}

async function parseBackup(filePath) {
  const stat = await statFile(filePath);
  if (stat.size > maxArchiveBytes) {
    throw new BackupError("Backup archive exceeds the 100 MB limit", 413);
  }

  let directory;
  try {
    directory = await unzipper.Open.file(filePath);
  } catch {
    throw new BackupError("Backup file is not a valid ZIP archive");
  }
  if (directory.files.length > maxAttachments + 2) {
    throw new BackupError("Backup contains too many files");
  }

  const files = new Map();
  let expandedBytes = 0;
  for (const file of directory.files) {
    if (file.type !== "File")
      throw new BackupError("Directories are not allowed in backups");
    const name = file.path;
    if (
      name !== "manifest.json" &&
      name !== "data.json" &&
      !/^attachments\/[\da-f-]{36}\.webp$/.test(name)
    ) {
      throw new BackupError(
        "Backup contains an unexpected or unsafe file path"
      );
    }
    if (files.has(name))
      throw new BackupError("Backup contains duplicate filenames");
    expandedBytes += file.uncompressedSize;
    if (expandedBytes > maxExpandedBytes) {
      throw new BackupError("Backup expands beyond the 250 MB limit", 413);
    }
    if (name === "data.json" && file.uncompressedSize > maxJsonBytes) {
      throw new BackupError("Backup JSON exceeds the 100 MB limit", 413);
    }
    if (
      name.startsWith("attachments/") &&
      file.uncompressedSize > maxAttachmentBytes
    ) {
      throw new BackupError("An attachment exceeds the 5 MB limit", 413);
    }
    files.set(name, file);
  }
  if (!files.has("manifest.json") || !files.has("data.json")) {
    throw new BackupError("Backup must contain manifest.json and data.json");
  }

  let manifest;
  let data;
  try {
    manifest = JSON.parse(
      (await files.get("manifest.json").buffer()).toString("utf8")
    );
    data = JSON.parse((await files.get("data.json").buffer()).toString("utf8"));
  } catch {
    throw new BackupError("Backup contains invalid JSON");
  }
  if (
    !isObject(manifest) ||
    manifest.format !== "mydiary-backup" ||
    manifest.schemaVersion !== schemaVersion ||
    typeof manifest.backupId !== "string" ||
    !/^[\da-f-]{36}$/.test(manifest.backupId)
  ) {
    throw new BackupError("Unsupported or invalid backup manifest");
  }
  hasOnlyFields(
    manifest,
    new Set([
      "format",
      "schemaVersion",
      "backupId",
      "createdAt",
      "includesTrash",
      "includesLocked",
      "counts",
    ]),
    "manifest"
  );
  validTimestamp(manifest.createdAt, "Manifest createdAt");
  if (typeof manifest.includesTrash !== "boolean") {
    throw new BackupError("Manifest includesTrash must be true or false");
  }
  if (
    manifest.includesLocked !== undefined &&
    typeof manifest.includesLocked !== "boolean"
  ) {
    throw new BackupError("Manifest includesLocked must be true or false");
  }
  if (!isObject(data) || !isObject(data.profile)) {
    throw new BackupError(
      "Backup data must include profile, entries, and tasks"
    );
  }
  hasOnlyFields(data, new Set(["profile", "entries", "tasks"]), "backup data");
  hasOnlyFields(
    data.profile,
    new Set(["email", "displayName"]),
    "profile metadata"
  );
  if (
    !Array.isArray(data.entries) ||
    !Array.isArray(data.tasks) ||
    data.entries.length > maxRecords ||
    data.tasks.length > maxRecords
  ) {
    throw new BackupError("Backup has invalid or excessive record counts");
  }
  return { manifest, data, files, expandedBytes };
}

async function bufferForFile(file) {
  return file.buffer();
}

async function validateBackup(parsed, userId) {
  const { manifest, data, files } = parsed;
  if (
    typeof data.profile.email !== "string" ||
    data.profile.email.length > 254 ||
    typeof data.profile.displayName !== "string" ||
    data.profile.displayName.length > 80
  ) {
    throw new BackupError("Backup profile metadata is invalid");
  }
  const referencedFiles = new Set(["manifest.json", "data.json"]);
  let attachmentCount = 0;
  let trashedCount = 0;
  let lockedCount = 0;
  const entryDocs = [];
  const attachmentWrites = [];
  const entryIds = new Set();
  for (const value of data.entries) {
    hasOnlyFields(value, entryFields, "entry");
    if (
      typeof value.backupId !== "string" ||
      !/^[\da-f-]{36}$/.test(value.backupId) ||
      entryIds.has(value.backupId)
    ) {
      throw new BackupError("Entry backup identifiers must be unique UUIDs");
    }
    entryIds.add(value.backupId);
    if (!validDate(value.date)) throw new BackupError("Entry date is invalid");
    if (value.deletedAt !== null && value.deletedAt !== undefined) {
      validTimestamp(value.deletedAt, "Entry deletedAt");
      trashedCount += 1;
    }
    if (!Array.isArray(value.tags) || value.tags.length > 10) {
      throw new BackupError("Entry tags must be an array of at most 10 items");
    }
    if (
      value.tags.some(
        (tag) => typeof tag !== "string" || !tag.trim() || tag.length > 24
      )
    ) {
      throw new BackupError("Entry contains an invalid tag");
    }
    if (!diaryMoods.includes(value.mood)) {
      throw new BackupError("Entry mood is invalid");
    }
    if (typeof value.title !== "string" || value.title.length > 160) {
      throw new BackupError("Entry title is invalid");
    }
    if (typeof value.content !== "string" || value.content.length > 100_000) {
      throw new BackupError("Entry content is invalid");
    }
    if (value.isLocked !== undefined && typeof value.isLocked !== "boolean") {
      throw new BackupError("Entry isLocked must be true or false");
    }
    if (value.isLocked === true) lockedCount += 1;
    if (!Array.isArray(value.images) || value.images.length > 5) {
      throw new BackupError("An entry may contain at most five attachments");
    }
    const createdAt = validTimestamp(value.createdAt, "Entry createdAt");
    const updatedAt = validTimestamp(value.updatedAt, "Entry updatedAt");
    const images = [];
    for (const image of value.images) {
      hasOnlyFields(image, attachmentFields, "attachment");
      const expectedPath = `attachments/${image.backupId}.webp`;
      if (
        typeof image.backupId !== "string" ||
        !/^[\da-f-]{36}$/.test(image.backupId) ||
        image.path !== expectedPath ||
        image.mimeType !== "image/webp" ||
        typeof image.originalName !== "string" ||
        image.originalName.length > 180 ||
        !Number.isInteger(image.size) ||
        image.size < 1 ||
        image.size > maxAttachmentBytes ||
        !Number.isInteger(image.width) ||
        image.width < 1 ||
        !Number.isInteger(image.height) ||
        image.height < 1 ||
        typeof image.sha256 !== "string" ||
        !/^[\da-f]{64}$/.test(image.sha256)
      ) {
        throw new BackupError("Attachment metadata is invalid");
      }
      if (!files.has(image.path) || referencedFiles.has(image.path)) {
        throw new BackupError(
          "Backup is missing an attachment or repeats its path"
        );
      }
      const buffer = await bufferForFile(files.get(image.path));
      const digest = createHash("sha256").update(buffer).digest("hex");
      if (digest !== image.sha256 || buffer.length !== image.size) {
        throw new BackupError("Attachment checksum or size does not match");
      }
      let metadata;
      try {
        metadata = await sharp(buffer, {
          limitInputPixels: 40_000_000,
        }).metadata();
      } catch {
        throw new BackupError("An attachment is not a valid image");
      }
      if (
        metadata.format !== "webp" ||
        metadata.width !== image.width ||
        metadata.height !== image.height
      ) {
        throw new BackupError(
          "Attachment image data does not match its metadata"
        );
      }
      referencedFiles.add(image.path);
      images.push({
        id: randomUUID(),
        originalName: path.basename(image.originalName.replaceAll("\\", "/")),
        mimeType: "image/webp",
        size: buffer.length,
        width: metadata.width,
        height: metadata.height,
        createdAt: validTimestamp(image.createdAt, "Attachment createdAt"),
      });
      attachmentWrites.push({ id: images.at(-1).id, buffer });
      attachmentCount += 1;
    }
    const sanitizedContent = sanitizeHtml(value.content, {
      allowedTags: ["b", "strong", "i", "em", "u", "br", "p", "div", "span"],
      allowedAttributes: { span: ["style"] },
      allowedStyles: {
        span: {
          color: [/^#[\da-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i],
        },
      },
    });
    if (value.isFavorite !== true && value.isFavorite !== false) {
      throw new BackupError("Entry isFavorite must be true or false");
    }
    if (value.isDraft !== true && value.isDraft !== false) {
      throw new BackupError("Entry isDraft must be true or false");
    }
    if (!isObject(value.formatting)) {
      throw new BackupError("Entry formatting must be an object");
    }
    hasOnlyFields(
      value.formatting,
      new Set([
        "fontFamily",
        "fontSize",
        "textColor",
        "textAlign",
        "pageStyle",
        "theme",
      ]),
      "entry formatting"
    );
    if (
      !value.isDraft &&
      (!value.title.trim() || !plainContent(sanitizedContent))
    ) {
      throw new BackupError("Published entries require a title and content");
    }
    const doc = new DiaryEntry({
      userId,
      title: value.title,
      content: sanitizedContent,
      date: value.date,
      formatting: value.formatting || {},
      mood: value.mood,
      tags: value.tags,
      isFavorite: value.isFavorite === true,
      isDraft: value.isDraft === true,
      isLocked: value.isLocked === true,
      deletedAt: value.deletedAt
        ? validTimestamp(value.deletedAt, "Entry deletedAt")
        : null,
      images,
      createdAt,
      updatedAt,
    });
    await doc.validate();
    entryDocs.push(doc);
  }
  for (const name of files.keys()) {
    if (!referencedFiles.has(name)) {
      throw new BackupError("Backup contains an unreferenced file");
    }
  }
  if (
    !isObject(manifest.counts) ||
    Object.keys(manifest.counts).some(
      (key) => !["entries", "tasks", "attachments"].includes(key)
    ) ||
    !Number.isInteger(manifest.counts.entries) ||
    !Number.isInteger(manifest.counts.tasks) ||
    !Number.isInteger(manifest.counts.attachments) ||
    manifest.counts.entries !== data.entries.length ||
    manifest.counts.tasks !== data.tasks.length ||
    manifest.counts.attachments !== attachmentCount
  ) {
    throw new BackupError("Backup manifest counts do not match its contents");
  }
  if (!manifest.includesTrash && trashedCount) {
    throw new BackupError("Backup contains trashed entries but excludes Trash");
  }
  if (manifest.includesLocked !== true && lockedCount) {
    throw new BackupError(
      "Backup contains locked entries but does not declare them"
    );
  }

  const taskDocs = [];
  const taskIds = new Set();
  const recurrenceIds = new Map();
  const recurrenceKeys = new Set();
  for (const value of data.tasks) {
    hasOnlyFields(value, taskFields, "task");
    if (
      typeof value.backupId !== "string" ||
      !/^[\da-f-]{36}$/.test(value.backupId) ||
      taskIds.has(value.backupId)
    ) {
      throw new BackupError("Task backup identifiers must be unique UUIDs");
    }
    taskIds.add(value.backupId);
    if (
      typeof value.text !== "string" ||
      !value.text.trim() ||
      value.text.trim().length > 120 ||
      !validDate(value.dueDate) ||
      !taskStatuses.includes(value.status) ||
      !taskPriorities.includes(value.priority) ||
      !taskRecurrences.includes(value.recurrence)
    ) {
      throw new BackupError("Task fields are invalid");
    }
    const createdAt = validTimestamp(value.createdAt, "Task createdAt");
    const updatedAt = validTimestamp(value.updatedAt, "Task updatedAt");
    let recurrenceSeriesId;
    if (value.recurrenceSeriesBackupId) {
      if (
        value.recurrence === "NONE" ||
        typeof value.recurrenceSeriesBackupId !== "string" ||
        !/^[\da-f-]{36}$/.test(value.recurrenceSeriesBackupId)
      ) {
        throw new BackupError("Task recurrence reference is invalid");
      }
      if (!recurrenceIds.has(value.recurrenceSeriesBackupId)) {
        recurrenceIds.set(
          value.recurrenceSeriesBackupId,
          new mongoose.Types.ObjectId()
        );
      }
      recurrenceSeriesId = recurrenceIds.get(value.recurrenceSeriesBackupId);
      const recurrenceKey = `${value.recurrenceSeriesBackupId}:${value.dueDate}`;
      if (recurrenceKeys.has(recurrenceKey)) {
        throw new BackupError(
          "Backup contains duplicate recurrence occurrences"
        );
      }
      recurrenceKeys.add(recurrenceKey);
    } else if (value.recurrence !== "NONE") {
      throw new BackupError("Recurring tasks must include a series reference");
    }
    const task = new DailyTask({
      userId,
      text: value.text.trim(),
      date: value.dueDate,
      dueDate: value.dueDate,
      status: value.status,
      completed: value.status === "COMPLETED",
      priority: value.priority,
      recurrence: value.recurrence,
      ...(recurrenceSeriesId
        ? {
            recurrenceSeriesId,
            recurrenceKey: `${recurrenceSeriesId}:${value.dueDate}`,
          }
        : {}),
      createdAt,
      updatedAt,
    });
    await task.validate();
    taskDocs.push(task);
  }
  return {
    attachmentWrites,
    attachmentCount,
    entryDocs,
    taskDocs,
    statistics: {
      entries: entryDocs.length,
      trashedEntries: trashedCount,
      tasks: taskDocs.length,
      attachments: attachmentCount,
      archiveBytes: parsed.expandedBytes,
    },
  };
}

async function loadAndValidate(req) {
  if (!req.file) throw new BackupError("Choose a backup ZIP file");
  const parsed = await parseBackup(req.file.path);
  const validated = await validateBackup(parsed, req.authUser._id);
  return { parsed, validated };
}

async function removeTemporaryUpload(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Failed to remove temporary backup upload", error);
    }
  }
}

export async function previewBackup(req, res) {
  try {
    const { parsed, validated } = await loadAndValidate(req);
    const alreadyImported = await BackupImport.exists({
      userId: req.authUser._id,
      backupId: parsed.manifest.backupId,
    });
    res.json({
      backupId: parsed.manifest.backupId,
      exportedAt: parsed.manifest.createdAt,
      includesTrash: parsed.manifest.includesTrash === true,
      alreadyImported: Boolean(alreadyImported),
      statistics: validated.statistics,
    });
  } finally {
    if (req.file?.path) await removeTemporaryUpload(req.file.path);
  }
}

export async function importBackup(req, res) {
  if (req.get("X-Backup-Confirmed") !== "true") {
    if (req.file?.path) await removeTemporaryUpload(req.file.path);
    return res
      .status(400)
      .json({ message: "Explicit backup restore confirmation is required" });
  }

  let parsed;
  let validated;
  try {
    ({ parsed, validated } = await loadAndValidate(req));
  } finally {
    if (req.file?.path) await removeTemporaryUpload(req.file.path);
  }

  let importRecord;
  try {
    importRecord = await BackupImport.create({
      userId: req.authUser._id,
      backupId: parsed.manifest.backupId,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "This backup has already been imported or is being restored",
      });
    }
    throw error;
  }

  const imageIds = [];
  const entryIds = validated.entryDocs.map((entry) => entry._id);
  const taskIds = validated.taskDocs.map((task) => task._id);
  try {
    await ensureImageStorage();
    for (const attachment of validated.attachmentWrites) {
      try {
        await writeFile(imageFilePath(attachment.id), attachment.buffer, {
          flag: "wx",
          mode: 0o600,
        });
        imageIds.push(attachment.id);
      } catch (error) {
        if (error.code !== "EEXIST") imageIds.push(attachment.id);
        throw error;
      }
    }
    for (const entry of validated.entryDocs) entry.userId = req.authUser._id;
    for (const task of validated.taskDocs) task.userId = req.authUser._id;
    if (validated.entryDocs.length)
      await DiaryEntry.insertMany(validated.entryDocs);
    if (validated.taskDocs.length)
      await DailyTask.insertMany(validated.taskDocs);
    await BackupImport.updateOne(
      { _id: importRecord._id },
      { $set: { status: "COMPLETED", completedAt: new Date() } }
    );
  } catch (error) {
    const cleanup = await Promise.allSettled([
      DiaryEntry.deleteMany({
        _id: { $in: entryIds },
        userId: req.authUser._id,
      }),
      DailyTask.deleteMany({ _id: { $in: taskIds }, userId: req.authUser._id }),
      ...imageIds.map((id) => deleteStoredImage(id)),
    ]);
    if (cleanup.some((result) => result.status === "rejected")) {
      await BackupImport.updateOne(
        { _id: importRecord._id },
        { $set: { status: "CLEANUP_REQUIRED" } }
      );
      console.error("Backup import cleanup requires recovery", {
        backupId: parsed.manifest.backupId,
        userId: String(req.authUser._id),
      });
    } else {
      await BackupImport.deleteOne({ _id: importRecord._id });
    }
    throw error;
  }

  await invalidateUserReadCache(req.authUser._id);
  res.status(201).json({
    message: "Backup restored successfully",
    statistics: validated.statistics,
  });
}
