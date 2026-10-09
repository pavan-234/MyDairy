import User from "../models/User.js";
import {
  authCookieName,
  expiredSessionCookieOptions,
  verifySessionToken,
} from "../config/auth.js";

function isJwtError(error) {
  return ["JsonWebTokenError", "NotBeforeError", "TokenExpiredError"].includes(
    error.name
  );
}

async function loadAuthenticatedUser(req, res, optional) {
  const token = req.cookies?.[authCookieName];
  if (!token) {
    if (!optional) {
      res.status(401).json({ message: "Authentication required" });
    }
    return;
  }

  let payload;
  try {
    payload = verifySessionToken(token);
  } catch (error) {
    if (!isJwtError(error)) throw error;
    if (optional) {
      res.clearCookie(authCookieName, expiredSessionCookieOptions());
      return;
    }
    res.clearCookie(authCookieName, expiredSessionCookieOptions());
    res.status(401).json({ message: "Invalid or expired session" });
    return;
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.sub !== "string" ||
    !Number.isInteger(payload.ver)
  ) {
    if (optional) {
      res.clearCookie(authCookieName, expiredSessionCookieOptions());
      return;
    }
    res.clearCookie(authCookieName, expiredSessionCookieOptions());
    res.status(401).json({ message: "Invalid or expired session" });
    return;
  }

  const user = await User.findById(payload.sub).select(
    "+tokenVersion +deletionRequestedAt"
  );
  if (!user || user.tokenVersion !== payload.ver) {
    if (optional) {
      res.clearCookie(authCookieName, expiredSessionCookieOptions());
      return;
    }
    res.clearCookie(authCookieName, expiredSessionCookieOptions());
    res.status(401).json({ message: "Invalid or expired session" });
    return;
  }

  const requestPath = req.originalUrl.split("?")[0];
  const allowedDuringDeletion =
    (req.method === "DELETE" && requestPath === "/api/profile") ||
    (req.method === "GET" &&
      ["/api/profile", "/api/auth/me"].includes(requestPath));
  if (user.deletionRequestedAt && !allowedDuringDeletion) {
    res.status(403).json({
      message:
        "Account deletion is pending; retry account deletion to continue",
    });
    return;
  }

  req.authUser = user;
}

export async function requireAuth(req, res, next) {
  await loadAuthenticatedUser(req, res, false);
  if (req.authUser) next();
}

export async function optionalAuth(req, res, next) {
  await loadAuthenticatedUser(req, res, true);
  next();
}
