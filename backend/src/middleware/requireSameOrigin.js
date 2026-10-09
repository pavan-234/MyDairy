import { getAuthConfig } from "../config/auth.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireSameOrigin(req, res, next) {
  if (safeMethods.has(req.method)) {
    next();
    return;
  }

  const origin = req.get("Origin");
  const { appOrigin } = getAuthConfig();
  if (origin !== appOrigin) {
    res.status(403).json({ message: "Request origin is not allowed" });
    return;
  }

  next();
}
