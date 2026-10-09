import jwt from "jsonwebtoken";
import { isIP } from "node:net";

export const authCookieName = "mydiary_session";
export const tokenIssuer = "mydiary";
export const tokenAudience = "mydiary-web";
export const tokenLifetimeSeconds = 30 * 60;

function isLoopbackHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") {
    return true;
  }
  if (isIP(host) === 4) {
    return Number(host.split(".")[0]) === 127;
  }
  return false;
}

export function getAuthConfig(env = process.env) {
  const secret = env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("JWT_SECRET must be set and contain at least 32 bytes");
  }

  let appOrigin;
  try {
    const configuredOrigin = new URL(env.APP_ORIGIN);
    if (
      configuredOrigin.pathname !== "/" ||
      configuredOrigin.search ||
      configuredOrigin.hash ||
      configuredOrigin.username ||
      configuredOrigin.password
    ) {
      throw new Error("APP_ORIGIN must contain only an origin");
    }
    appOrigin = configuredOrigin.origin;
  } catch {
    throw new Error("APP_ORIGIN must be a valid application origin");
  }

  const originUrl = new URL(appOrigin);
  if (!["http:", "https:"].includes(originUrl.protocol)) {
    throw new Error("APP_ORIGIN must use HTTP or HTTPS");
  }
  if (originUrl.protocol === "http:" && !isLoopbackHost(originUrl.hostname)) {
    throw new Error("HTTP APP_ORIGIN is allowed only for loopback development");
  }

  if (!["true", "false"].includes(env.COOKIE_SECURE)) {
    throw new Error("COOKIE_SECURE must be explicitly set to true or false");
  }
  const secureCookie = env.COOKIE_SECURE === "true";
  if (secureCookie !== (originUrl.protocol === "https:")) {
    throw new Error("COOKIE_SECURE must match the APP_ORIGIN protocol");
  }

  return {
    secret,
    appOrigin,
    secureCookie,
  };
}

export function createSessionToken(user) {
  const { secret } = getAuthConfig();
  return jwt.sign({ ver: user.tokenVersion }, secret, {
    algorithm: "HS256",
    audience: tokenAudience,
    expiresIn: tokenLifetimeSeconds,
    issuer: tokenIssuer,
    subject: user.id,
  });
}

export function verifySessionToken(token) {
  const { secret } = getAuthConfig();
  return jwt.verify(token, secret, {
    algorithms: ["HS256"],
    audience: tokenAudience,
    issuer: tokenIssuer,
  });
}

export function sessionCookieOptions() {
  const { secureCookie } = getAuthConfig();
  return {
    httpOnly: true,
    maxAge: tokenLifetimeSeconds * 1000,
    path: "/",
    sameSite: "lax",
    secure: secureCookie,
  };
}

export function expiredSessionCookieOptions() {
  const { maxAge, ...options } = sessionCookieOptions();
  return options;
}
