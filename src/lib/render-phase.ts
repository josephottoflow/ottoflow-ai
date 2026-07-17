/**
 * Queue/list adapter over the render-status single source of truth.
 *
 * `lib/video/status.ts` is the SSOT ("any queue/activity surface MUST derive
 * status through this module"). It returns a rich 5-stage VideoJobStatus built
 * for the job detail page; list surfaces (queue, dashboard, project cards) only
 * need a coarse phase + a badge. This module does NOT re-derive anything — it
 * delegates to deriveVideoJobStatus() and collapses its stages, so there is
 * still exactly one place where backend signals are interpreted.
 *
 * Why this exists at all: render_jobs.status is written ONLY by the legacy
 * synchronous /api/generate route. The async V1 path (/api/video/generate +
 * BullMQ worker) inserts status="queued" and thereafter records progress in
 * merge_status / merged_video_url, never advancing status — so any surface
 * reading `status` directly showed finished renders as "queued" forever.
 */
import { deriveVideoJobStatus } from "./video/status";
import type { DbRenderJob } from "./types";

export type RenderPhase = "ready" | "working" | "failed" | "queued";

/** Collapse the SSOT's 5 stages into the 4 a list/badge surface renders.
 * Scene rows aren't fetched by list queries; deriveVideoJobStatus handles the
 * empty case (merge_status / merged_video_url still resolve the stage). */
export function phaseOf(job: DbRenderJob): RenderPhase {
  const { stage } = deriveVideoJobStatus(job);
  if (stage === "ready") return "ready";
  if (stage === "failed") return "failed";
  if (stage === "generating" || stage === "composing") return "working";
  return "queued";
}

/** In-flight = still on its way to a video (what a "queue" actually holds).
 * Excludes finished and failed, so queue depth and cost estimates stop counting
 * completed renders forever. */
export function isInFlight(job: DbRenderJob): boolean {
  const p = phaseOf(job);
  return p === "working" || p === "queued";
}
