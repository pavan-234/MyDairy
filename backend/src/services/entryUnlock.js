import jwt from "jsonwebtoken";
import { getAuthConfig, tokenIssuer } from "../config/auth.js";

export const entryUnlockLifetimeSeconds = 5 * 60;
const entryUnlockAudience = "mydiary-entry-unlock";
const cookieName = "mydiary_entry_unlock";

export function entryUnlockCookieName() {
  return cookieName;
}

function cookieOptions() {
  const { secureCookie } = getAuthConfig();
  return {
    httpOnly: true,
    maxAge: entryUnlockLifetimeSeconds * 1000,
    path: "/api/entries",
    sameSite: "strict",
    secure: secureCookie,
  };
}

export function setEntryUnlockCookie(res, entry, user) {
  const { secret } = getAuthConfig();
  const token = jwt.sign(
    {
      entry: String(entry._id),
      lockVer: entry.unlockVersion || 0,
      ver: user.tokenVersion,
    },
    secret,
    {
      algorithm: "HS256",
      audience: entryUnlockAudience,
      expiresIn: entryUnlockLifetimeSeconds,
      issuer: tokenIssuer,
      subject: String(user._id),
    }
  );
  res.cookie(entryUnlockCookieName(), token, cookieOptions());
}

export function clearEntryUnlockCookie(res) {
  const options = cookieOptions();
  delete options.maxAge;
  res.clearCookie(entryUnlockCookieName(), options);
}

export function hasValidEntryUnlock(req, entry) {
  const entryId = String(entry._id);
  const token = req.cookies?.[entryUnlockCookieName()];
  if (!token) return false;

  try {
    const { secret } = getAuthConfig();
    const payload = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      audience: entryUnlockAudience,
      issuer: tokenIssuer,
    });
    return (
      payload &&
      typeof payload === "object" &&
      payload.sub === String(req.authUser._id) &&
      payload.entry === entryId &&
      payload.ver === req.authUser.tokenVersion &&
      payload.lockVer === (entry.unlockVersion || 0)
    );
  } catch (error) {
    if (
      ["JsonWebTokenError", "NotBeforeError", "TokenExpiredError"].includes(
        error.name
      )
    ) {
      return false;
    }
    throw error;
  }
}
