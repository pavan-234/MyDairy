import argon2 from "argon2";
import User from "../models/User.js";
import {
  authCookieName,
  createSessionToken,
  expiredSessionCookieOptions,
  sessionCookieOptions,
} from "../config/auth.js";
import { clearEntryUnlockCookie } from "../services/entryUnlock.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
  };
}

function setSession(res, user) {
  res.cookie(authCookieName, createSessionToken(user), sessionCookieOptions());
}

function validateCredentials(body, registering) {
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const displayName =
    typeof body?.displayName === "string" ? body.displayName.trim() : "";

  if (email.length > 254 || !emailPattern.test(email)) {
    return { error: "Enter a valid email address" };
  }
  if (
    password.length > 128 ||
    (registering && password.length < 12) ||
    (!registering && password.length === 0)
  ) {
    return {
      error: registering
        ? "Password must be between 12 and 128 characters"
        : "Invalid email or password",
    };
  }
  if (registering && displayName.length > 80) {
    return { error: "Display name must be 80 characters or fewer" };
  }

  return { email, password, displayName };
}

export async function register(req, res) {
  const credentials = validateCredentials(req.body, true);
  if (credentials.error) {
    return res.status(400).json({ message: credentials.error });
  }

  const passwordHash = await argon2.hash(credentials.password, {
    type: argon2.argon2id,
  });

  let user;
  try {
    user = await User.create({
      email: credentials.email,
      passwordHash,
      displayName: credentials.displayName,
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    return res
      .status(409)
      .json({ message: "An account with this email already exists" });
  }

  setSession(res, user);
  res.status(201).json({ user: safeUser(user) });
}

export async function login(req, res) {
  const credentials = validateCredentials(req.body, false);
  if (credentials.error) {
    return res.status(400).json({ message: credentials.error });
  }

  const user = await User.findOne({ email: credentials.email }).select(
    "+passwordHash +tokenVersion +deletionRequestedAt"
  );
  if (
    !user ||
    !(await argon2.verify(user.passwordHash, credentials.password))
  ) {
    return res.status(401).json({ message: "Invalid email or password" });
  }
  if (user.deletionRequestedAt) {
    return res.status(403).json({
      message:
        "Account deletion is pending; retry deletion from the active session",
    });
  }

  setSession(res, user);
  res.json({ user: safeUser(user) });
}

export async function getCurrentUser(req, res) {
  res.json({ user: safeUser(req.authUser) });
}

export async function logout(req, res) {
  if (req.authUser) {
    await User.updateOne(
      { _id: req.authUser._id },
      { $inc: { tokenVersion: 1 } }
    );
  }

  res.clearCookie(authCookieName, expiredSessionCookieOptions());
  clearEntryUnlockCookie(res);
  res.json({ message: "Logged out successfully" });
}
