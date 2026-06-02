/**
 * BullMQ queue helpers. Used from both the Next.js process (to enqueue)
 * and the worker process (to consume). REDIS_URL presence is guaranteed
 * by whichever env validator ran first: src/lib/env.ts on the Next side,
 * src/lib/worker-env.ts on the worker side.
 */
import { Queue, type QueueOptions, type JobsOptions, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

// ─── Redis singleton ─────────────────────────────────────────────────────────
// We hold the actual IORedis instance separately from the BullMQ-shaped
// ConnectionOptions cast so callers can attach event listeners (see
// attachRedisLogger) for ops visibility on disconnects / reconnects.

let redisInstance: IORedis | null = null;

function getRedisInstance(): IORedis {
  if (redisInstance) return redisInstance;
  const url = process.env.REDIS_URL;
  if (!url) {
    // Should be unreachable — env.ts / worker-env.ts catch this at boot.
    throw new Error(
      "[queue] REDIS_URL is not set — env validator was bypassed?"
    );
  }
  redisInstance = new IORedis(url, {
    // BullMQ requires this; suppresses ioredis's internal command retry that
    // would otherwise interact badly with BullMQ's own retry semantics.
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Cap the reconnect delay so a long Redis outage produces logs at a
    // reasonable cadence (default doubles each time up to 30s — we cap at 5s
    // to keep the worker visibly trying without spamming).
    retryStrategy(times) {
      return Math.min(times * 100, 5_000);
    },
  });
  return redisInstance;
}

/**
 * BullMQ's connection option (a cast view of the IORedis instance).
 * BullMQ ships its own bundled ioredis types which are nominally distinct
 * from the top-level ioredis types — the runtime instance is identical.
 */
export function getRedis(): ConnectionOptions {
  return getRedisInstance() as unknown as ConnectionOptions;
}

/**
 * Raw IORedis client for non-BullMQ use cases (rate limiting, idempotency
 * cache). Same singleton instance as BullMQ uses, just typed as IORedis
 * directly so callers can call commands without the ConnectionOptions cast.
 */
export function getRedisClient(): IORedis {
  return getRedisInstance();
}

/**
 * Wire ioredis lifecycle events to an arbitrary logger so operators can see
 * disconnects / reconnects in the worker log stream. Idempotent — safe to
 * call multiple times (but each registers fresh listeners; call once at boot).
 */
export function attachRedisLogger(
  log: (msg: string, extra?: Record<string, unknown>) => void
): void {
  const r = getRedisInstance();
  r.on("connect", () => log("redis.connect"));
  r.on("ready", () => log("redis.ready"));
  r.on("close", () => log("redis.close"));
  r.on("reconnecting", (delay: number) => log("redis.reconnecting", { delay }));
  r.on("end", () => log("redis.end"));
  r.on("error", (err: Error) => log("redis.error", { error: err.message }));
}

/**
 * Disconnect the singleton Redis client. Call from the worker shutdown
 * sequence after BullMQ workers are closed.
 */
export async function disconnectRedis(): Promise<void> {
  if (!redisInstance) return;
  try {
    await redisInstance.quit();
  } catch {
    redisInstance.disconnect();
  }
  redisInstance = null;
}

// ─── Queue names (string-typed for safety across processes) ───────────────────
export const QUEUE_NAMES = {
  brandResearch: "brand-research",
  contentGeneration: "content-generation",
  videoMerge: "video-merge",
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ─── Per-queue payload schemas ────────────────────────────────────────────────
export interface BrandResearchJobData {
  brandId: string;
  researchJobId: string;
  // Snapshot of the input so the worker doesn't have to re-query
  name: string;
  website: string;
  industry: string;
}

export interface ContentGenerationJobData {
  brandId: string;
  contentItemId: string;
  contentJobId: string;
  // Required user-facing input
  platform: "linkedin" | "facebook" | "instagram" | "twitter" | "blog" | "email";
  // Optional steering
  userPrompt?: string;
  pillarId?: string;
}

/**
 * Payload for the post-pipeline ffmpeg merge that combines the Pexels stock
 * clip + ElevenLabs narration + Jamendo music into a single downloadable MP4
 * (audio baked in). Fields are URLs / data URLs the worker can fetch.
 */
export interface VideoMergeOverlay {
  /** ALL CAPS 1-3 word phrase to bake on-screen via drawtext. */
  text: string;
  /** Seconds from video start (0..videoDuration). */
  start: number;
  end: number;
}

/**
 * Phase 6 multi-scene clip — one entry per storyboard scene that the
 * /api/generate route already resolved (Runway/Luma/Pexels via the
 * provider registry). When `scenes` is present, the merge worker
 * concatenates them in order via the ffmpeg concat demuxer instead of
 * using a single pre-fetched `videoUrl`.
 */
export interface VideoMergeScene {
  index: number;             // 1-based, matches storyboard.scenes[].index
  url: string;               // direct MP4 URL (Pexels / Runway / Luma CDN)
  durationSec: number;       // target on-screen duration
  provider?: string;         // for diagnostic logging
}

export interface VideoMergeJobData {
  renderJobId: string;
  userId: string;
  videoUrl: string;              // legacy single-clip path — fallback when no scenes
  // Optional inputs — merge gracefully skips whichever is missing:
  audioDataUrl?: string;         // ElevenLabs narration as data:audio/mpeg;base64,...
  musicUrl?: string;             // Jamendo MP3 streaming URL
  musicDuckingDb?: number;       // default -12, only used if musicUrl present
  /**
   * Phase 4 keyword overlay list. When present, the worker re-encodes the
   * video with FFmpeg drawtext filters (scale pop + fade in/out) instead of
   * stream-copying — slower but visually punchy.
   */
  overlays?: VideoMergeOverlay[];
  /**
   * Phase 6 multi-scene composition. When present (≥ 2 scenes), the
   * worker concats them in scene_number order, normalizes to 1080x1920@30fps,
   * then runs the existing overlay + audio merge pass. Falls back to the
   * `videoUrl` single-clip path if scenes is empty or absent.
   */
  scenes?: VideoMergeScene[];
}

export interface JobPayloads {
  "brand-research": BrandResearchJobData;
  "content-generation": ContentGenerationJobData;
  "video-merge": VideoMergeJobData;
}

// ─── Queue accessors ──────────────────────────────────────────────────────────
const queues = new Map<QueueName, Queue>();

const defaultJobOpts: JobsOptions = {
  attempts: 2,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600 },
};

export function getQueue<N extends QueueName>(name: N): Queue<JobPayloads[N]> {
  const existing = queues.get(name);
  if (existing) return existing as Queue<JobPayloads[N]>;

  const opts: QueueOptions = {
    connection: getRedis(),
    defaultJobOptions: defaultJobOpts,
  };
  const q = new Queue<JobPayloads[N]>(name, opts);
  queues.set(name, q as Queue);
  return q;
}

// Convenience
export const brandResearchQueue = () => getQueue(QUEUE_NAMES.brandResearch);
export const contentGenerationQueue = () => getQueue(QUEUE_NAMES.contentGeneration);
export const videoMergeQueue = () => getQueue(QUEUE_NAMES.videoMerge);
