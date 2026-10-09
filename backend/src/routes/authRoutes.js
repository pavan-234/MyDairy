import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  getCurrentUser,
  login,
  logout,
  register,
} from "../controllers/authController.js";
import { optionalAuth, requireAuth } from "../middleware/requireAuth.js";

const router = Router();
const authenticationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler(_req, res) {
    res.status(429).json({
      message: "Too many authentication attempts. Please try again later.",
    });
  },
});

router.post("/register", authenticationLimiter, register);
router.post("/login", authenticationLimiter, login);
router.get("/me", requireAuth, getCurrentUser);
router.post("/logout", optionalAuth, logout);

export default router;
