/**
 * Video V1 — render-status single source of truth (UX layer, Track B Task 0).
 *
 * Pure, dependency-free derivation of a user-facing job state from the raw
 * `render_jobs` row + its `scene_generations` rows. Both the Video Job page
 * (/video/[jobId]) and any queue/activity surface MUST derive status through
 * this module so the stage, progress %, and copy never disagree across screens.
 *
 * The ai-first pipeline runs:  queued → generating(scene k/N) → composing → ready
 * (or → failed at any point). We map the backend signals to those five stages:
 *
 *   render_jobs.status        "queued" | "rendering" | "done" | "failed"
 *   render_jobs.merge_status  "pending" | "merging" | "done" | "failed" | null
 *   render_jobs.merged_video_url   set ⇒ final MP4 exists (ready)
 *   scene_generations[]       one row per COMPLETED scene (count = scenes done)
 *   video_strategy.scenes[]   planned scene count (total); defaults to 4
 *
 * No network, no DB, no React — safe to unit-test and to call on the server
 * (page load) or client (poll tick). See deriveVideoJobStatus().
 */
import type { DbRenderJob, DbSceneGeneration } from "@/lib/types";

/** Five user-facing stages of an ai-first render. */
export type VideoJobStage = "queued" | "generating" | "composing" | "ready" | "failed";

export interface VideoJobStatus {
  stage: VideoJobStage;
  /** 0–100, monotonic-ish across the pipeline (best estimate). */
  progressPct: number;
  /** Short stage label, e.g. "Generating scenes". */
  label: string;
  /** One-line human detail, e.g. "Scene 2 of 4" / "Queued — waiting for a worker". */
  detail: string;
  scenesDone: number;
  scenesTotal: number;
  /** True when a final MP4 is playable (`merged_video_url` present). */
  isReady: boolean;
  /** True only for the failed stage. */
  isFailed: boolean;
  /** Populated when failed (merge_error → error_message → generic). */
  failureReason: string | null;
  /** Queued with no progress past the stuck threshold → likely worker/queue issue. */
  isStuck: boolean;
}

/** Default "stuck" threshold: queued with zero scenes for >3 min. */
export const STUCK_THRESHOLD_MS = 180_000;

const STAGE_LABEL: Record<VideoJobStage, string> = {
  queued: "Queued",
  generating: "Generating scenes",
  composing: "Composing video",
  ready: "Ready",
  failed: "Failed",
};

/** Read the planned scene count off the (migration-022) video_strategy jsonb. */
function plannedSceneCount(job: DbRenderJob): number {
  const vs = (job as { video_strategy?: { scenes?: unknown[] } }).video_strategy;
  const n = Array.isArray(vs?.scenes) ? vs.scenes.length : 0;
  return n > 0 ? n : 4; // strategy is a 4-beat arc by default
}

/**
 * Derive the user-facing status for an ai-first render job.
 *
 * Precedence (highest first): failed → ready → composing → generating → queued.
 * `opts.now` / `opts.stuckMs` are injectable for testing.
 */
export function deriveVideoJobStatus(
  job: DbRenderJob,
  scenes: DbSceneGeneration[] = [],
  opts: { now?: number; stuckMs?: number } = {},
): VideoJobStatus {
  const now = opts.now ?? Date.now();
  const stuckMs = opts.stuckMs ?? STUCK_THRESHOLD_MS;

  const scenesTotal = plannedSceneCount(job);
  const scenesDone = Math.min(scenes.length, scenesTotal);
  const isReady = !!job.merged_video_url;
  const failed = job.status === "failed" || job.merge_status === "failed";
  const failureReason =
    job.merge_error ?? job.error_message ?? (failed ? "Render failed" : null);

  let stage: VideoJobStage;
  if (failed && !isReady) stage = "failed";
  else if (isReady) stage = "ready";
  else if (job.merge_status === "merging" || (scenesTotal > 0 && scenesDone >= scenesTotal))
    stage = "composing";
  else if (job.status === "rendering" || scenesDone > 0) stage = "generating";
  else stage = "queued";

  // Progress: queued 5 → generating 10..70 (scene-weighted) → composing 85 → ready 100.
  let progressPct: number;
  switch (stage) {
    case "ready":
      progressPct = 100;
      break;
    case "composing":
      progressPct = 85;
      break;
    case "generating":
      progressPct = 10 + Math.round((scenesDone / Math.max(1, scenesTotal)) * 60);
      break;
    case "failed":
      // freeze at where it failed: compose-stage ≈ 85, scene-stage scene-weighted.
      progressPct =
        scenesDone >= scenesTotal && scenesTotal > 0
          ? 85
          : 10 + Math.round((scenesDone / Math.max(1, scenesTotal)) * 60);
      break;
    default:
      progressPct = 5; // queued
  }

  const startedAtMs = Date.parse(job.started_at ?? job.created_at ?? "") || now;
  const isStuck =
    stage === "queued" && scenesDone === 0 && now - startedAtMs > stuckMs;

  const detail = buildDetail(stage, { scenesDone, scenesTotal, failureReason, isStuck });

  return {
    stage,
    progressPct,
    label: STAGE_LABEL[stage],
    detail,
    scenesDone,
    scenesTotal,
    isReady,
    isFailed: stage === "failed",
    failureReason: stage === "failed" ? failureReason : null,
    isStuck,
  };
}

function buildDetail(
  stage: VideoJobStage,
  ctx: { scenesDone: number; scenesTotal: number; failureReason: string | null; isStuck: boolean },
): string {
  switch (stage) {
    case "queued":
      return ctx.isStuck
        ? "Still queued — the render worker hasn't picked this up. Check the worker/queue."
        : "Queued — waiting for a worker";
    case "generating":
      return `Generating scene ${Math.min(ctx.scenesDone + 1, ctx.scenesTotal)} of ${ctx.scenesTotal}`;
    case "composing":
      return "Composing the final video";
    case "ready":
      return "Your video is ready to preview and download";
    case "failed":
      return ctx.failureReason ? `Failed: ${ctx.failureReason}` : "Render failed";
  }
}
