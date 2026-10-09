import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import multer from "multer";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  exportBackup,
  importBackup,
  previewBackup,
} from "../controllers/backupController.js";

const router = Router();
const protectedExportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler(_req, res) {
    res.status(429).json({
      message: "Too many protected export attempts. Please try again later.",
    });
  },
});
const temporaryDirectory = path.resolve(
  process.env.BACKUP_TEMP_DIR || path.join(tmpdir(), "mydiary-backup-uploads")
);
mkdirSync(temporaryDirectory, { recursive: true, mode: 0o700 });
if (process.platform !== "win32") chmodSync(temporaryDirectory, 0o700);
const upload = multer({
  storage: multer.diskStorage({
    destination: temporaryDirectory,
    filename: (_req, _file, callback) => callback(null, `${randomUUID()}.zip`),
  }),
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 1,
    fields: 0,
    parts: 1,
  },
}).single("backup");

router.get("/export", exportBackup);
router.post("/export", protectedExportLimiter, exportBackup);
router.post("/import/preview", upload, previewBackup);
router.post("/import", upload, importBackup);

export default router;
