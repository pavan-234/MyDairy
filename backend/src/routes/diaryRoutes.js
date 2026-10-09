import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  deleteEntryImage,
  getEntryImage,
  loadActiveOwnedEntry,
  loadOwnedEntry,
  requireEntryUnlocked,
  uploadEntryImage,
} from "../controllers/imageController.js";
import { imageUpload } from "../middleware/imageUpload.js";
import {
  createEntry,
  deleteEntry,
  getCalendarActivity,
  getCalendarDay,
  getCalendarDates,
  getEntries,
  getEntry,
  getStreak,
  getTrashEntries,
  lockEntry,
  permanentlyDeleteEntry,
  restoreTrashEntry,
  unlockEntry,
  updateEntry,
} from "../controllers/diaryController.js";

const router = Router();
const entryUnlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler(_req, res) {
    res.status(429).json({
      message: "Too many unlock attempts. Please try again later.",
    });
  },
});

router.get("/calendar/dates", getCalendarDates);
router.get("/calendar/activity", getCalendarActivity);
router.get("/calendar/day", getCalendarDay);
router.get("/streak", getStreak);
router.get("/trash", getTrashEntries);
router.post("/trash/:id/restore", restoreTrashEntry);
router.delete("/trash/:id", permanentlyDeleteEntry);
router.post("/:id/unlock", entryUnlockLimiter, unlockEntry);
router.post("/:id/lock", lockEntry);
router.post(
  "/:id/images",
  loadActiveOwnedEntry,
  requireEntryUnlocked,
  imageUpload,
  uploadEntryImage
);
router.get(
  "/:id/images/:imageId",
  loadOwnedEntry,
  requireEntryUnlocked,
  getEntryImage
);
router.delete(
  "/:id/images/:imageId",
  loadActiveOwnedEntry,
  requireEntryUnlocked,
  deleteEntryImage
);
router.get("/", getEntries);
router.get("/:id", getEntry);
router.post("/", createEntry);
router.put("/:id", updateEntry);
router.delete("/:id", deleteEntry);

export default router;
