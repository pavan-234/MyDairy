import argon2 from "argon2";
import BackupImport from "../models/BackupImport.js";
import DailyTask from "../models/DailyTask.js";
import DiaryEntry from "../models/DiaryEntry.js";
import User from "../models/User.js";
import { deleteStoredImage } from "../services/imageStorage.js";
import { invalidateUserReadCache } from "../services/readCache.js";
import {
  authCookieName,
  createSessionToken,
  expiredSessionCookieOptions,
  sessionCookieOptions,
} from "../config/auth.js";

const notificationPreferenceFields = new Set([
  "browserNotifications",
  "taskReminders",
]);

function safeProfile(user) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    createdAt: user.createdAt,
    notificationPreferences: {
      browserNotifications:
        user.notificationPreferences?.browserNotifications ?? false,
      taskReminders: user.notificationPreferences?.taskReminders ?? false,
    },
  };
}

function validateProfileUpdate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Profile data must be a JSON object" };
  }
  const allowedFields = new Set(["displayName", "notificationPreferences"]);
  for (const field of Object.keys(body)) {
    if (!allowedFields.has(field)) {
      return { error: `Profile field cannot be updated: ${field}` };
    }
  }
  if (!Object.keys(body).length) {
    return { error: "Provide at least one profile field to update" };
  }

  const update = {};
  if (body.displayName !== undefined) {
    const trimmedName =
      typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (
      typeof body.displayName !== "string" ||
      [...body.displayName].some((character) => {
        const code = character.codePointAt(0);
        return code <= 31 || code === 127;
      }) ||
      !trimmedName ||
      trimmedName.length > 80
    ) {
      return {
        error: "Name must contain 1–80 characters and no control characters",
      };
    }
    update.displayName = trimmedName;
  }

  if (body.notificationPreferences !== undefined) {
    const preferences = body.notificationPreferences;
    if (
      !preferences ||
      typeof preferences !== "object" ||
      Array.isArray(preferences)
    ) {
      return { error: "notificationPreferences must be an object" };
    }
    for (const field of Object.keys(preferences)) {
      if (!notificationPreferenceFields.has(field)) {
        return { error: `Unknown notification preference: ${field}` };
      }
      if (typeof preferences[field] !== "boolean") {
        return { error: `${field} must be true or false` };
      }
    }
    if (!Object.keys(preferences).length) {
      return { error: "Provide at least one notification preference" };
    }
    for (const [field, value] of Object.entries(preferences)) {
      update[`notificationPreferences.${field}`] = value;
    }
  }

  return { update };
}

export async function getProfile(req, res) {
  res.json({ profile: safeProfile(req.authUser) });
}

export async function updateProfile(req, res) {
  const validation = validateProfileUpdate(req.body);
  if (validation.error) {
    return res.status(400).json({ message: validation.error });
  }

  const user = await User.findByIdAndUpdate(
    req.authUser._id,
    { $set: validation.update },
    { new: true, runValidators: true }
  );
  if (!user)
    return res.status(401).json({ message: "Authentication required" });

  res.json({ profile: safeProfile(user) });
}

export async function changePassword(req, res) {
  const body = req.body;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (field) => !["currentPassword", "newPassword"].includes(field)
    ) ||
    typeof body.currentPassword !== "string" ||
    !body.currentPassword ||
    typeof body.newPassword !== "string" ||
    body.newPassword.length < 12 ||
    body.newPassword.length > 128
  ) {
    return res.status(400).json({
      message:
        "Provide the current password and a new password of 12–128 characters",
    });
  }

  const user = await User.findById(req.authUser._id).select(
    "+passwordHash +tokenVersion"
  );
  if (
    !user ||
    !(await argon2.verify(user.passwordHash, body.currentPassword))
  ) {
    return res.status(401).json({ message: "Current password is incorrect" });
  }
  if (body.currentPassword === body.newPassword) {
    return res
      .status(400)
      .json({ message: "New password must differ from the current password" });
  }

  const passwordHash = await argon2.hash(body.newPassword, {
    type: argon2.argon2id,
  });
  const updated = await User.findOneAndUpdate(
    { _id: user._id, tokenVersion: user.tokenVersion },
    { $set: { passwordHash }, $inc: { tokenVersion: 1 } },
    { new: true }
  ).select("+tokenVersion");
  if (!updated) {
    return res.status(409).json({
      message: "Account security changed; sign in again before retrying",
    });
  }

  res.cookie(
    authCookieName,
    createSessionToken(updated),
    sessionCookieOptions()
  );
  res.json({ message: "Password changed successfully" });
}

export async function deleteAccount(req, res) {
  const body = req.body;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (field) => !["currentPassword", "confirmation"].includes(field)
    ) ||
    typeof body.currentPassword !== "string" ||
    typeof body.confirmation !== "string"
  ) {
    return res
      .status(400)
      .json({ message: "Account deletion confirmation is invalid" });
  }
  if (body.confirmation !== "DELETE") {
    return res.status(400).json({
      message: 'Type "DELETE" to confirm permanent account deletion',
    });
  }

  const user = await User.findById(req.authUser._id).select(
    "+passwordHash +tokenVersion +deletionRequestedAt"
  );
  if (
    !user ||
    !(await argon2.verify(user.passwordHash, body.currentPassword))
  ) {
    return res.status(401).json({ message: "Current password is incorrect" });
  }

  await User.updateOne(
    { _id: user._id },
    { $set: { deletionRequestedAt: user.deletionRequestedAt || new Date() } }
  );

  const ownedEntries = await DiaryEntry.find({ userId: user._id })
    .select("images.id")
    .lean();
  for (const entry of ownedEntries) {
    for (const image of entry.images || []) {
      await deleteStoredImage(image.id);
    }
  }

  await Promise.all([
    DiaryEntry.deleteMany({ userId: user._id }),
    DailyTask.deleteMany({ userId: user._id }),
    BackupImport.deleteMany({ userId: user._id }),
  ]);

  const remaining = await Promise.all([
    DiaryEntry.exists({ userId: user._id }),
    DailyTask.exists({ userId: user._id }),
    BackupImport.exists({ userId: user._id }),
  ]);
  if (remaining.some(Boolean)) {
    throw new Error("Account deletion did not remove all owned records");
  }

  await invalidateUserReadCache(user._id);
  await User.deleteOne({ _id: user._id });
  res.clearCookie(authCookieName, expiredSessionCookieOptions());
  res.json({ message: "Account and its data were permanently deleted" });
}
