import cookieParser from "cookie-parser";
import express from "express";
import authRoutes from "./routes/authRoutes.js";
import backupRoutes from "./routes/backupRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import diaryRoutes from "./routes/diaryRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import taskRoutes from "./routes/taskRoutes.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { requireSameOrigin } from "./middleware/requireSameOrigin.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());
  app.use("/api", requireSameOrigin);
  app.use("/api/auth", authRoutes);
  app.use("/api/backup", requireAuth, backupRoutes);
  app.use("/api/profile", requireAuth, profileRoutes);
  app.use("/api/dashboard", requireAuth, dashboardRoutes);
  app.use("/api/entries", requireAuth, diaryRoutes);
  app.use("/api/tasks", requireAuth, taskRoutes);

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(error);

    let statusCode = error.status || 500;
    if (error.code === "LIMIT_FILE_SIZE") statusCode = 413;
    else if (
      error.name === "MulterError" ||
      error.name === "CastError" ||
      error.name === "ValidationError"
    ) {
      statusCode = 400;
    }

    res.status(statusCode).json({
      message:
        statusCode === 500
          ? "Something went wrong on the server"
          : error.message,
    });
  });

  return app;
}
