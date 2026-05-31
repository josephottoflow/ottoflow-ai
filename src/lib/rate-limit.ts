/**
 * Redis-backed sliding-window rate limiter.
 *
 * Uses a sorted set per key: each request adds a (timestamp, unique-id) pair,
 * old entries are pruned by score, the remaining count is the request rate.
 * Atomic via MULTI/EXEC.
 *
 * Why sliding window (not fixed-window INCR+EXPIRE):
 *   Fixed windows allow 2× burst at the boundary (10 req at 0:59 + 10 req at
 *   1:00 = 20 req in 1 second from a 10/min limit). Sliding handles bursts
 *   cleanly. Slightly more memory (one ZSET entry per req in window) but
 *   the windows here are minutes/hours and the rps is low.
 *
 * Failure mode:
 *   If Redis is unreachable, the limiter FAILS OPEN (logs the error, allows
 *   the request). Better to over-serve a few requests than to lock everyone
 *   out of the app while Redis recovers.
 */
import "server-only";
import { getRedisClient } from "./queue";

export interface RateLimitResult {
  /** True if the request is within budget and should proceed. */
  ok: boolean;
  /** Requests used in the current window (including this one if ok). */
  used: number;
  /** Max requests allowed in the window. */
  limit: number;
  /** Seconds until the window slides far enough to allow another request. */
  retryAfterSeconds: number;
}

export interface RateLimitOptions {
  /** Unique identifier — usually `${route}:${userId}` or `${route}:${ip}`. */
  key: string;
  /** Max requests permitted within `windowSeconds`. */
  limit: number;
  /** Sliding window length in seconds. */
  windowSeconds: number;
}

/**
 * Check + record a request against the limit. Returns ok=false if the request
 * should be rejected with 429. The caller is responsible for sending the
 * `Retry-After` header from `retryAfterSeconds`.
 */
export async function rateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const { key, limit, windowSeconds } = opts;
  const redisKey = `rl:${key}`;
  const now = Date.now();
  const windowMs = windowSeconds * 1_000;
  const cutoff = now - windowMs;

  try {
    const redis = getRedisClient();
    // Atomic: prune old, count remaining, add this request, set ttl.
    // Member is "<ts>-<rand>" to dedupe simultaneous requests in same ms.
    const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;
    const pipeline = redis.multi();
    pipeline.zremrangebyscore(redisKey, 0, cutoff);
    pipeline.zcard(redisKey);
    pipeline.zadd(redisKey, now, member);
    pipeline.expire(redisKey, windowSeconds + 5); // small grace so key survives slow clients
    const results = await pipeline.exec();
    if (!results) throw new Error("redis pipeline returned null");

    // results[1] is [err, count-before-add]
    const countBefore = Number(results[1]?.[1] ?? 0);
    const used = countBefore + 1;

    if (used > limit) {
      // Over budget — undo our zadd so we don't poison the window further.
      await redis.zrem(redisKey, member);
      // Compute retry-after from oldest entry: when it slides out, one slot frees.
      const oldest = await redis.zrange(redisKey, 0, 0, "WITHSCORES");
      const oldestTs = oldest.length >= 2 ? Number(oldest[1]) : now;
      const retryAfter = Math.max(1, Math.ceil((oldestTs + windowMs - now) / 1_000));
      return { ok: false, used: countBefore, limit, retryAfterSeconds: retryAfter };
    }

    return { ok: true, used, limit, retryAfterSeconds: 0 };
  } catch (err) {
    // Fail open — log loudly so we notice in the worker log stream.
    console.error(
      "[rate-limit] Redis failure, allowing request:",
      err instanceof Error ? err.message : err
    );
    return { ok: true, used: 0, limit, retryAfterSeconds: 0 };
  }
}
