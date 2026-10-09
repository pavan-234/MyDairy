import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  changePassword,
  deleteAccount,
  getProfile,
  updateProfile,
} from "../controllers/profileController.js";

const router = Router();
const sensitiveActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler(_req, res) {
    res.status(429).json({
      message: "Too many security attempts. Please try again later.",
    });
  },
});

router.get("/", getProfile);
router.patch("/", updateProfile);
router.post("/password", sensitiveActionLimiter, changePassword);
router.delete("/", sensitiveActionLimiter, deleteAccount);

export default router;
