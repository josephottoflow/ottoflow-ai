/**
 * Redis distributed lock (P1.3). Ensures only ONE worker replica runs the
 * publish scheduler sweep / reaper at a time. SET NX PX acquire; Lua
 * compare-and-delete release (never frees another holder's lock); TTL auto-
 * expires if the holder dies, so a crashed sweeper can't wedge the lock.
 */
import { randomUUID } from "node:crypto";
import { getRedisClient } from "@/lib/queue";

export const SCHEDULER_LOCK_KEY = "ottoflow:publish:scheduler:lock";
export const REAPER_LOCK_KEY = "ottoflow:publish:reaper:lock";

const RELEASE_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** Acquire the lock; returns a token if acquired, else null. */
export async function acquireLock(key: string, ttlMs: number): Promise<string | null> {
  const token = randomUUID();
  const res = await getRedisClient().set(key, token, "PX", ttlMs, "NX");
  return res === "OK" ? token : null;
}

/** Release only if we still own it (token match). Best-effort. */
export async function releaseLock(key: string, token: string): Promise<void> {
  try {
    await getRedisClient().eval(RELEASE_LUA, 1, key, token);
  } catch {
    // best-effort; the TTL will expire it anyway
  }
}

/** Current lock holder token (for diagnostics), or null if unlocked. */
export async function lockOwner(key: string): Promise<string | null> {
  try {
    return (await getRedisClient().get(key)) ?? null;
  } catch {
    return null;
  }
}

/** Run fn only if the lock is acquired; returns null if another holder has it. */
export async function withLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const token = await acquireLock(key, ttlMs);
  if (!token) return null;
  try {
    return await fn();
  } finally {
    await releaseLock(key, token);
  }
}
