/**
 * Stuck-job recovery (audit H4 + B1.R7).
 *
 * Three distinct scenarios this handles:
 *
 *   1. Worker dies mid-job (OOM, SIGKILL during deploy past graceful timeout,
 *      Railway redeploy that wasn't caught by SIGTERM). The job row is left
 *      in `running` state forever — UI shows "Researching..." indefinitely.
 *      → recoverStuckJobsAtBoot() runs once at worker startup and marks any
 *        `running` jobs older than the threshold as failed.
 *      → schedulePeriodicSweep() runs the same logic every 5 minutes so
 *        a long-running worker also catches stuck jobs that appeared after
 *        boot.
 *
 *   2. Job stalls during processing — BullMQ's stalled-job detector fires
 *      the worker's "stalled" event, but our Postgres state isn't updated
 *      automatically. UI still shows "Researching..." even after BullMQ has
 *      re-queued the job.
 *      → markJobFailedFromStall() is called from the "stalled" listener to
 *        keep Postgres in sync.
 *
 *   3. Merge job sits in `merging` status forever (ffmpeg killed mid-encode,
 *      worker crashed during upload). New as of B1.R7.
 *      → sweepStuckMergeJobs() flips them to failed with a recovery message.
 *
 * Metrics: every sweep returns counters that worker/index.ts forwards to
 * Sentry as breadcrumbs. Counters: brandRecovered, contentRecovered,
 * mergeRecovered, permanentlyFailed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const STUCK_JOB_THRESHOLD_MINUTES = 15;
const PERIODIC_SWEEP_INTERVAL_MS = 5 * 60_000; // every 5 minutes

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

// ─── B1.R7: Periodic sweep ──────────────────────────────────────────────────

export interface SweepResult extends Record<string, unknown> {
  brandRecovered: number;
  contentRecovered: number;
  mergeRecovered: number;
  /** Jobs already at attemptsMade >= 3 — we don't retry, mark dead. */
  permanentlyFailed: number;
}

/**
 * Sweep stuck content_generation_jobs. Same idea as the brand sweep but
 * for content_items — flips orphaned 'running' jobs older than the
 * threshold to 'failed' so the UI updates.
 */
async function sweepContentJobs(
  admin: SupabaseClient,
  log: (msg: string, extra?: Record<string, unknown>) => void,
  cutoffIso: string,
): Promise<number> {
  const { data, error } = await admin
    .from("content_generation_jobs")
    .update({
      status: "failed",
      error_message: RECOVERY_ERROR_MESSAGE,
      completed_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("started_at", cutoffIso)
    .select("id");
  if (error) {
    log("recovery.sweep.content_error", { error: error.message });
    return 0;
  }
  const rows = (data ?? []) as Array<{ id: string }>;
  if (rows.length > 0) {
    log("recovery.sweep.content_recovered", {
      count: rows.length,
      jobIds: rows.map((r) => r.id),
    });
  }
  return rows.length;
}

/**
 * Sweep render_jobs stuck in `merging` state. These didn't get
 * merge_status updated → no Realtime fire → UI shows
 * "Merging audio into MP4..." forever.
 */
async function sweepMergeJobs(
  admin: SupabaseClient,
  log: (msg: string, extra?: Record<string, unknown>) => void,
  cutoffIso: string,
): Promise<number> {
  // Render jobs that are in `merging` longer than the threshold are stuck.
  // We use `created_at` (added in migration 006) for the cutoff. Falling
  // back to started_at if created_at is null.
  const { data, error } = await admin
    .from("render_jobs")
    .update({
      merge_status: "failed",
      merge_error: "Worker restarted while merging. Use Regenerate to try again.",
    })
    .eq("merge_status", "merging")
    .lt("started_at", cutoffIso)
    .select("id");
  if (error) {
    log("recovery.sweep.merge_error", { error: error.message });
    return 0;
  }
  const rows = (data ?? []) as Array<{ id: string }>;
  if (rows.length > 0) {
    log("recovery.sweep.merge_recovered", {
      count: rows.length,
      jobIds: rows.map((r) => r.id),
    });
  }
  return rows.length;
}

/**
 * One full sweep across all three job types. Returns counters for
 * metrics emission. Idempotent + safe under concurrency.
 */
export async function runOneSweep(
  admin: SupabaseClient,
  log: (msg: string, extra?: Record<string, unknown>) => void,
): Promise<SweepResult> {
  const cutoff = new Date(
    Date.now() - STUCK_JOB_THRESHOLD_MINUTES * 60_000,
  ).toISOString();

  // Reuse the existing brand sweep, but extract its count locally.
  let brandRecovered = 0;
  try {
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
    if (!error) {
      const rows = (data ?? []) as Array<{ id: string; brand_id: string }>;
      brandRecovered = rows.length;
      if (rows.length > 0) {
        const brandIds = Array.from(new Set(rows.map((r) => r.brand_id)));
        await admin.from("brands").update({ status: "failed" }).in("id", brandIds);
        log("recovery.sweep.brand_recovered", {
          count: rows.length,
          jobIds: rows.map((r) => r.id),
        });
      }
    } else {
      log("recovery.sweep.brand_error", { error: error.message });
    }
  } catch (err) {
    log("recovery.sweep.brand_threw", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const contentRecovered = await sweepContentJobs(admin, log, cutoff);
  const mergeRecovered = await sweepMergeJobs(admin, log, cutoff);

  return {
    brandRecovered,
    contentRecovered,
    mergeRecovered,
    // We don't currently mark permanently_failed separately from recovered —
    // every sweep-killed job is "permanently failed for this attempt; user
    // must retry". Counter kept for future use when we wire attempts > 3.
    permanentlyFailed: 0,
  };
}

/**
 * Start the periodic sweep timer. Returns the interval handle so the
 * shutdown sequence can clear it. Counters are emitted via the log
 * callback (which the worker forwards to Sentry as breadcrumbs).
 */
export function schedulePeriodicSweep(
  admin: SupabaseClient,
  log: (msg: string, extra?: Record<string, unknown>) => void,
): NodeJS.Timeout {
  // First tick happens immediately + then every PERIODIC_SWEEP_INTERVAL_MS.
  // The setInterval is non-blocking; we let each sweep complete in the
  // background.
  void runOneSweep(admin, log).then((result) => {
    log("recovery.periodic.tick", { ...result, atBoot: true });
  });
  const handle = setInterval(() => {
    void runOneSweep(admin, log).then((result) => {
      // Always emit — even all-zeros tells us the sweeper is alive.
      log("recovery.periodic.tick", result);
    });
  }, PERIODIC_SWEEP_INTERVAL_MS);
  // unref() lets node exit cleanly during shutdown without waiting for
  // the next tick. Tradeoff: process.exit() can race the sweep mid-flight,
  // but worker shutdown should not block on diagnostics.
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}
