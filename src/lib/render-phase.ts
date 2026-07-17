/**
 * Single source of truth for a render job's user-visible phase.
 *
 * `render_jobs.status` is written ONLY by the legacy synchronous /api/generate
 * route (status: rendering/done/failed). The async V1 path
 * (/api/video/generate + BullMQ worker) inserts status="queued" and thereafter
 * records progress exclusively in `merge_status` / `merged_video_url` — it
 * never advances `status`. Reading `status` alone therefore reports every
 * finished async render as "queued" forever.
 *
 * `merged_video_url` is the honest completion signal: it is set only after a
 * successful compose + upload (see getKPISummary in db.ts). `status` is kept as
 * a fallback so legacy rows written by /api/generate still resolve correctly.
 *
 * This is the derivation VideoHistoryClient already used correctly; it is
 * lifted here verbatim so every surface agrees on one definition.
 */
import type { DbRenderJob } from "./types";

export type RenderPhase = "ready" | "working" | "failed" | "queued";

export function phaseOf(job: DbRenderJob): RenderPhase {
  if (job.merge_status === "done" && job.merged_video_url) return "ready";
  if (job.status === "failed" || job.merge_status === "failed") return "failed";
  if (
    job.merge_status === "merging" ||
    job.merge_status === "pending" ||
    job.status === "rendering"
  )
    return "working";
  return "queued";
}

/** In-flight = still on its way to a video (what a "queue" actually holds).
 * Excludes finished and failed jobs, so queue depth and cost estimates stop
 * counting completed renders forever. */
export function isInFlight(job: DbRenderJob): boolean {
  const p = phaseOf(job);
  return p === "working" || p === "queued";
}
