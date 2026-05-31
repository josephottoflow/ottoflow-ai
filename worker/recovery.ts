/**
 * Stuck-job recovery (audit H4).
 *
 * Two distinct scenarios this handles:
 *
 *   1. Worker dies mid-job (OOM, SIGKILL during deploy past graceful timeout,
 *      Railway redeploy that wasn't caught by SIGTERM). The job row is left
 *      in `running` state forever — UI shows "Researching..." indefinitely.
 *      → recoverStuckJobsAtBoot() runs once at worker startup and marks any
 *        `running` jobs older than the threshold as failed.
 *
 *   2. Job stalls during processing — BullMQ's stalled-job detector fires
 *      the worker's "stalled" event, but our Postgres state isn't updated
 *      automatically. UI still shows "Researching..." even after BullMQ has
 *      re-queued the job.
 *      → markJobFailedFromStall() is called from the "stalled" listener to
 *        keep Postgres in sync.
 *
 * Both paths also flip the parent brand.status to 'failed' so the brand
 * card reflects the failure state.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const STUCK_JOB_THRESHOLD_MINUTES = 15;

const RECOVERY_ERROR_MESSAGE =
  "Worker restarted while processing this job. Automatic recovery marked it failed; please retry.";

const STALLED_ERROR_MESSAGE =
  "Job stalled — worker likely crashed mid-processing. Please retry.";

/**
 * Boot-time sweep: any `running` jobs older than the threshold are orphans
 * from a previous worker that died. Mark them failed so the UI doesn't sit
 * at "Researching" forever and the user knows to retry.
 *
 * Idempotent + safe to call from multiple worker instances (UPDATEs target
 * a stable set; concurrent runs just no-op against already-updated rows).
 */
export async function recoverStuckJobsAtBoot(
  admin: SupabaseClient,
  log: (msg: string, extra?: Record<string, unknown>) => void
): Promise<void> {
  const cutoff = new Date(
    Date.now() - STUCK_JOB_THRESHOLD_MINUTES * 60_000
  ).toISOString();

  const { data, error } = await admin
    .from("brand_research_jobs")
    .update({
      status: "failed",
      error_message: RECOVERY_ERROR_MESSAGE,
      completed_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("started_at", cutoff)
    .select("id, brand_id");

  if (error) {
    log("recovery.boot.error", {
      error: error.message,
      thresholdMinutes: STUCK_JOB_THRESHOLD_MINUTES,
    });
    return;
  }

  const rows = (data ?? []) as Array<{ id: string; brand_id: string }>;

  if (rows.length === 0) {
    log("recovery.boot.clean", { thresholdMinutes: STUCK_JOB_THRESHOLD_MINUTES });
    return;
  }

  log("recovery.boot.recovered", {
    count: rows.length,
    thresholdMinutes: STUCK_JOB_THRESHOLD_MINUTES,
    jobIds: rows.map((r) => r.id),
  });

  // Mirror status on parent brands so the list view reflects reality.
  const brandIds = Array.from(new Set(rows.map((r) => r.brand_id)));
  const { error: brandErr } = await admin
    .from("brands")
    .update({ status: "failed" })
    .in("id", brandIds);

  if (brandErr) {
    log("recovery.boot.brand_update_error", { error: brandErr.message });
  }
}

/**
 * Called from BullMQ's "stalled" event. The job has been re-queued by BullMQ
 * but our Postgres row is still `running`. Mark it failed so the UI updates.
 *
 * Guarded by status check: only updates if still `running` (avoids racing
 * a separate worker that already picked it up and completed it).
 */
export async function markJobFailedFromStall(
  admin: SupabaseClient,
  bullJobId: string,
  log: (msg: string, extra?: Record<string, unknown>) => void
): Promise<void> {
  // BullMQ jobId matches our brand_research_jobs.id (set in /api/brands).
  const { data, error } = await admin
    .from("brand_research_jobs")
    .update({
      status: "failed",
      error_message: STALLED_ERROR_MESSAGE,
      completed_at: new Date().toISOString(),
    })
    .eq("id", bullJobId)
    .eq("status", "running")
    .select("brand_id")
    .maybeSingle();

  if (error) {
    log("recovery.stall.error", { jobId: bullJobId, error: error.message });
    return;
  }

  if (!data) {
    // Either the job id doesn't exist or it was already in a terminal state —
    // either way nothing to do, log for visibility.
    log("recovery.stall.noop", { jobId: bullJobId, reason: "not_running" });
    return;
  }

  log("recovery.stall.marked_failed", { jobId: bullJobId, brandId: data.brand_id });

  // Mirror on the parent brand.
  const { error: brandErr } = await admin
    .from("brands")
    .update({ status: "failed" })
    .eq("id", data.brand_id);

  if (brandErr) {
    log("recovery.stall.brand_update_error", {
      jobId: bullJobId,
      brandId: data.brand_id,
      error: brandErr.message,
    });
  }
}
