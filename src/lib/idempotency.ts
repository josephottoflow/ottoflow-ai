/**
 * Redis-backed idempotency cache for POST endpoints.
 *
 * Clients send `Idempotency-Key: <opaque-string>` and the server stores the
 * first response under (userId, key). Subsequent calls within the TTL window
 * return the cached response instead of re-executing the side effect.
 *
 * Used to prevent duplicate brand creation when a network blip causes the
 * client to retry — without this, the user gets two brand rows and two
 * worker jobs charged against their plan.
 *
 * TTL is 24h: a reasonable window for "the same user retrying the same
 * request." Past that window the key collides with itself and we just
 * re-execute (low probability event).
 *
 * Failure mode:
 *   If Redis is unreachable, we FAIL OPEN — treat as cache miss and let the
 *   request through. Better to allow a possible duplicate than to lock the
 *   user out. (Worth pairing with a uniqueness constraint at the DB level
 *   for the most critical resources; for now the rate limiter caps blast
 *   radius.)
 */
import "server-only";
import { getRedisClient } from "./queue";

/** Strict format check: opaque token, alphanumeric + a few separators, 8-200 chars. */
const KEY_REGEX = /^[A-Za-z0-9_\-:.]{8,200}$/;

const TTL_SECONDS = 24 * 60 * 60;

function redisKey(userId: string, route: string, idempotencyKey: string): string {
  return `idem:${route}:${userId}:${idempotencyKey}`;
}

/**
 * Validate an Idempotency-Key value off the request header. Returns null
 * if header is missing OR malformed (caller treats as "no idempotency
 * requested", just executes normally). We don't error on malformed keys —
 * silently degrading is friendlier than 400ing legitimate retries.
 */
export function parseIdempotencyKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!KEY_REGEX.test(trimmed)) return null;
  return trimmed;
}

/**
 * Lookup a prior response for this (user, route, key). Returns the cached
 * JSON-serializable body if found, otherwise null.
 */
export async function getCachedResponse<T>(
  userId: string,
  route: string,
  key: string
): Promise<T | null> {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(redisKey(userId, route, key));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error(
      "[idempotency] cache lookup failed, treating as miss:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Persist a response body so a future retry with the same key short-circuits.
 * Best-effort — errors are logged but never thrown to the caller (the user
 * already got their response successfully; cache write failure must not
 * affect them).
 */
export async function setCachedResponse(
  userId: string,
  route: string,
  key: string,
  body: unknown
): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.set(redisKey(userId, route, key), JSON.stringify(body), "EX", TTL_SECONDS);
  } catch (err) {
    console.error(
      "[idempotency] cache write failed (response was sent successfully):",
      err instanceof Error ? err.message : err
    );
  }
}
