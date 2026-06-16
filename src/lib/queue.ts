/**
 * BullMQ queue helpers. Used from both the Next.js process (to enqueue)
 * and the worker process (to consume). REDIS_URL presence is guaranteed
 * by whichever env validator ran first: src/lib/env.ts on the Next side,
 * src/lib/worker-env.ts on the worker side.
 */
import { Queue, type QueueOptions, type JobsOptions, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import type { CompositionPlan, VideoStrategy } from "./ffmpeg-pipeline/types";

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
  // ADR-002 — FFmpeg multi-agent pipeline. Runs Agents 11 (compose) + 12
  // (QC) + storage upload in the worker. Payload is the frozen Agents 1-10
  // CompositionPlan.
  ffmpegCompose: "ffmpeg-compose",
  // Brand Creative Orchestrator Phase C — Imagen background + sharp
  // composite for an APPROVED creative brief. The Creative Approval Gate
  // contract: jobs are only enqueued from /api/creatives/[id]/review
  // (approve) and /api/creatives/[id]/regenerate; the processor refuses any
  // creative whose status isn't approved/generating.
  creativeGeneration: "creative-generation",
  // Ottoflow Video V1 — AI-first scene generation. Consumes a frozen
  // VideoStrategy, calls the video-provider registry (preferring Seedance)
  // once per scene, copies each clip to R2 (provider URLs expire), records
  // scene_generations, then enqueues `ffmpeg-compose`. Polling lives here
  // (worker) so it never hits the Vercel 300s SSE ceiling.
  sceneGeneration: "scene-generation",
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
  // V2 Phase 1 — recorded on research_runs for traceability. Defaults to
  // 'create' in the worker when absent (older queued jobs).
  trigger?: "create" | "retry" | "refresh" | "manual";
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
  /**
   * Video Pipeline v2 P2 — when present, marks which storyboard scene
   * this overlay belongs to. The worker uses this in P3 to rotate
   * position/style per scene so the video reads as edited (top-third
   * for scene 1, center for scene 2, etc.) instead of every overlay
   * landing at the same lower-third y-coordinate.
   *
   * Optional for backward compat: overlays without sceneIndex render
   * at the legacy default position (y=h*0.65).
   */
  sceneIndex?: number;
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

/**
 * Phase D — scene-generation deferred from /api/generate SSE to the
 * worker. When `sceneSpecs` is present, the worker iterates these
 * specs, calls registry.generateScene() per scene, persists each to
 * scene_generations, then proceeds with concat + overlay + audio merge
 * just like the legacy `scenes` array.
 *
 * Moving this out of the SSE handler eliminates the Vercel function
 * timeout exposure on Runway-heavy runs (audit C1/M2).
 */
export interface VideoMergeSceneSpec {
  index: number;                 // 1-based, matches storyboard.scenes[].index
  prompt: string;
  shotType: string | null;
  durationSec: number;
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
  /**
   * Phase D — when present, the worker generates these scenes via
   * registry.generateScene() BEFORE the concat pass. Mutually exclusive
   * with `scenes` (use one or the other). Generation results are
   * persisted to scene_generations as they complete.
   */
  sceneSpecs?: VideoMergeSceneSpec[];
  /**
   * Phase 1A (VIDEO_VARIATION_AUDIT §P1.4) — Gemini's storyboard already
   * produces an `aestheticNotes` string (palette, lighting, pacing,
   * references) that previously sat unused in the database. Pass it
   * through to the worker so it can prefix each scene prompt and steer
   * Runway/Luma toward a coherent visual style per video.
   *
   * Truncated to 400 chars at the worker before injection.
   */
  aestheticNotes?: string;
  /**
   * Video Pipeline v2 F3 — brand industry + topic title shared across
   * every scene in this job. Worker forwards into each
   * registryGenerateScene() call so the per-scene Pexels fallback (and
   * Runway's seed-photo search) can construct queries grounded in the
   * brand's actual industry instead of pattern-matching keywords from
   * the scene description.
   *
   * Optional for legacy free-form prompt callers without a brand record.
   */
  brandIndustry?: string | null;
  topicTitle?: string | null;
}

/**
 * ADR-002 — FFmpeg multi-agent pipeline job. The CompositionPlan is the
 * frozen output of Agents 1-10 (built in the SSE route by the orchestrator);
 * the worker consumes it with zero further LLM calls except the bounded QC
 * regen loop. `gdriveAccessToken` is optional and only set when the user
 * opted into "Save to my Drive" — used as the storage fallback when R2 is
 * unconfigured.
 */
export interface FfmpegComposeJobData {
  plan: CompositionPlan;
  gdriveAccessToken?: string | null;
}

/**
 * Creative Orchestrator Phase C — payload is intentionally tiny: the worker
 * re-reads the creative row + brief from Postgres so a stale queue entry can
 * never generate from an outdated brief.
 */
export interface CreativeGenerationJobData {
  creativeId: string;
  brandId: string;
  /** True when enqueued by the regenerate flow (diagnostics only). */
  regen?: boolean;
}

/**
 * Ottoflow Video V1 — scene-generation payload. The frozen VideoStrategy is
 * built in the SSE/API route (Agents 1-3 + strategy) so the worker does the
 * slow per-scene provider polling. Audio URLs are resolved by the route (same
 * ElevenLabs/Jamendo path as the stock pipeline) and forwarded so the
 * downstream ffmpeg-compose plan is complete; blank when audio is deferred.
 */
export interface SceneGenerationJobData {
  renderJobId: string;
  userId: string;
  topic: string;
  brandId?: string | null;
  brandIndustry?: string | null;
  strategy: VideoStrategy;
  /** Resolved narration (data: or https URL). Forwarded into the CompositionPlan. */
  narrationUrl?: string | null;
  /** Resolved background music URL (optional). */
  musicUrl?: string | null;
  /** Forwarded to ffmpeg-compose as the storage fallback when R2 is unset. */
  gdriveAccessToken?: string | null;
}

export interface JobPayloads {
  "brand-research": BrandResearchJobData;
  "content-generation": ContentGenerationJobData;
  "video-merge": VideoMergeJobData;
  "ffmpeg-compose": FfmpegComposeJobData;
  "creative-generation": CreativeGenerationJobData;
  "scene-generation": SceneGenerationJobData;
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
export const ffmpegComposeQueue = () => getQueue(QUEUE_NAMES.ffmpegCompose);
export const creativeGenerationQueue = () => getQueue(QUEUE_NAMES.creativeGeneration);
export const sceneGenerationQueue = () => getQueue(QUEUE_NAMES.sceneGeneration);
