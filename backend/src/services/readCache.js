import { createClient } from "redis";

const keyPrefix = "mydiary:read:v1";
const operationTimeoutMs = 200;
const pendingLoads = new Map();
let client;
let connectPromise;
let clientInitializationFailed = false;
let circuitOpenUntil = 0;
let lastWarningAt = 0;

function warnCacheUnavailable(error) {
  if (Date.now() - lastWarningAt < 30_000) return;
  lastWarningAt = Date.now();
  console.warn("Redis read cache unavailable; continuing without cache", error);
}

function runWithTimeout(operation) {
  let timeoutId;
  return Promise.race([
    operation(),
    new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Redis cache operation timed out")),
        operationTimeoutMs
      );
    }),
  ]).finally(() => clearTimeout(timeoutId));
}

function getClient() {
  if (client || clientInitializationFailed || !process.env.REDIS_URL)
    return client;
  try {
    client = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: (retries) =>
          Math.min(250 * 2 ** Math.min(retries, 4), 5000),
      },
    });
    client.on("error", warnCacheUnavailable);
    client.on("ready", () => {
      circuitOpenUntil = 0;
    });
  } catch (error) {
    clientInitializationFailed = true;
    warnCacheUnavailable(error);
  }
  return client;
}

export function connectReadCache() {
  const redis = getClient();
  if (!redis) return;
  if (connectPromise) return connectPromise;
  try {
    connectPromise = redis.connect().catch((error) => {
      warnCacheUnavailable(error);
    });
  } catch (error) {
    warnCacheUnavailable(error);
  }
  return connectPromise;
}

export async function disconnectReadCache() {
  if (client?.isOpen) await client.quit();
  client = undefined;
  connectPromise = undefined;
}

function isCacheReady(redis) {
  return Boolean(redis?.isReady && Date.now() >= circuitOpenUntil);
}

async function runCacheOperation(redis, operation) {
  try {
    return await runWithTimeout(operation);
  } catch (error) {
    circuitOpenUntil = Date.now() + 5000;
    warnCacheUnavailable(error);
    return undefined;
  }
}

export async function cacheAside({
  userId,
  resource,
  parameters,
  ttlSeconds,
  load,
}) {
  const redis = getClient();
  if (!isCacheReady(redis)) return load();

  const versionKey = `${keyPrefix}:user:${userId}:version`;
  const version = await runCacheOperation(redis, () => redis.get(versionKey));
  if (version === undefined || !isCacheReady(redis)) return load();

  const parameterKey = Buffer.from(JSON.stringify(parameters)).toString(
    "base64url"
  );
  const cacheKey = `${keyPrefix}:user:${userId}:${version || "0"}:${resource}:${parameterKey}`;
  const cached = await runCacheOperation(redis, () => redis.get(cacheKey));
  if (cached !== undefined && cached !== null) {
    try {
      return JSON.parse(cached);
    } catch (error) {
      warnCacheUnavailable(error);
      await runCacheOperation(redis, () => redis.del(cacheKey));
    }
  }

  if (!isCacheReady(redis)) return load();
  if (pendingLoads.has(cacheKey)) return pendingLoads.get(cacheKey);

  const pending = Promise.resolve()
    .then(load)
    .then(async (value) => {
      if (isCacheReady(redis)) {
        await runCacheOperation(redis, () =>
          redis.set(cacheKey, JSON.stringify(value), { EX: ttlSeconds })
        );
      }
      return value;
    })
    .finally(() => pendingLoads.delete(cacheKey));
  pendingLoads.set(cacheKey, pending);
  return pending;
}

export async function invalidateUserReadCache(userId) {
  const redis = getClient();
  if (!isCacheReady(redis)) return;
  await runCacheOperation(redis, () => {
    const versionKey = `${keyPrefix}:user:${userId}:version`;
    return redis
      .multi()
      .incr(versionKey)
      .expire(versionKey, 7 * 24 * 60 * 60)
      .exec();
  });
}
