/**
 * Ottoflow AI background worker.
 *
 * Deploys as its own process (Railway worker, Fly machine, etc.).
 *
 * Local dev:    npm run dev:worker    (tsx watch)
 * Production:   npm run start:worker  (runs the bundled output)
 *
 * BOOT ORDER (do not reorder casually):
 *   1. dotenv loads .env.local / .env so vars are present in process.env
 *      (no-op on Railway — env comes from the platform)
 *   2. worker-env validates the worker's required vars — throws + exits if
 *      anything is missing/invalid BEFORE BullMQ or anything else loads
 *   3. real imports (BullMQ, queue helpers, processor)
 *   4. attach Redis lifecycle logging so operators see connect / disconnect
 *   5. stuck-job recovery sweep (audit H4) — mark orphans from previous
 *      crashes as failed so the UI doesn't sit at "Researching" forever
 *   6. construct Worker and register signal handlers
 *
 * Validated env: see src/lib/worker-env.ts.
 */

// ─── Step 1: load .env files (Railway uses platform vars, so these no-op there) ─
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

// ─── Step 2: validate worker env BEFORE importing anything that reads env ────
import { workerEnv } from "@/lib/worker-env";

// ─── Step 2.5: init Sentry + bridge captureFallback() shim → @sentry/node ────
// Import after env validation (so a missing SENTRY_DSN doesn't trip env check)
// but BEFORE BullMQ / processors, so any boot-time crash from those modules
// is still captured. No-op when SENTRY_DSN is unset.
import { Sentry, flushSentry } from "./observability";

// ─── Step 3: real imports (these may read process.env at module load) ────────
import { Worker, type Job } from "bullmq";
import {
  getRedis,
  attachRedisLogger,
  disconnectRedis,
  QUEUE_NAMES,
  type BrandResearchJobData,
  type ContentGenerationJobData,
} from "@/lib/queue";
import { createAdminClient } from "@/lib/supabase";
import { processBrandResearch } from "./processors/brand-research";
import { processContentGeneration } from "./processors/content-generation";
import { recoverStuckJobsAtBoot, markJobFailedFromStall } from "./recovery";

// ─── Logging ─────────────────────────────────────────────────────────────────
// Minimal structured logger. Upgrade to pino in Phase 5 (audit M3).
function log(scope: string, msg: string, extra?: Record<string, unknown>) {
  const line = { ts: new Date().toISOString(), scope, msg, ...extra };
  console.log(JSON.stringify(line));
}

function logError(scope: string, msg: string, extra?: Record<string, unknown>) {
  const line = { ts: new Date().toISOString(), scope, msg, level: "error", ...extra };
  console.error(JSON.stringify(line));
}

// ─── Step 4: Redis event visibility ──────────────────────────────────────────
// Without this, a bad REDIS_URL just makes the worker silently do nothing.
attachRedisLogger((evt, extra) => log("redis", evt, extra));

// Single admin client reused for the recovery sweep + stalled-event handler.
// Worker writes use service role since they act on behalf of users without
// their session token; RLS is bypassed intentionally here.
const recoveryAdmin = createAdminClient();

// ─── Step 5: Stuck-job recovery sweep (H4) ───────────────────────────────────
// Fire-and-forget at boot. Don't block worker startup on this — if recovery
// fails, the worker should still start processing new jobs.
void recoverStuckJobsAtBoot(recoveryAdmin, (msg, extra) =>
  log("recovery", msg.replace(/^recovery\./, ""), extra)
).catch((err) => {
  logError("recovery", "boot.unhandled", {
    error: err instanceof Error ? err.message : String(err),
  });
});

// ─── Step 6: Brand Research worker ───────────────────────────────────────────
const brandResearchWorker = new Worker<BrandResearchJobData>(
  QUEUE_NAMES.brandResearch,
  async (job: Job<BrandResearchJobData>) => {
    log("brand-research", "job.start", { jobId: job.id, brandId: job.data.brandId });
    const result = await processBrandResearch(job.data, (step, progress) => {
      // BullMQ progress mirrors what we store in brand_research_jobs.
      job.updateProgress(progress).catch(() => {});
      log("brand-research", "step", { jobId: job.id, step, progress });
    });
    log("brand-research", "job.done", { jobId: job.id, brandId: job.data.brandId });
    return result;
  },
  {
    connection: getRedis(),
    concurrency: workerEnv.WORKER_CONCURRENCY,
  }
);

brandResearchWorker.on("active", (job) => {
  log("brand-research", "job.active", { jobId: job.id, brandId: job.data.brandId });
});

brandResearchWorker.on("completed", (job) => {
  log("brand-research", "job.completed", {
    jobId: job.id,
    brandId: job.data?.brandId,
    durationMs: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null,
  });
});

brandResearchWorker.on("failed", (job, err) => {
  logError("brand-research", "job.failed", {
    jobId: job?.id,
    brandId: job?.data?.brandId,
    attemptsMade: job?.attemptsMade,
    error: err?.message,
  });
  // Forward to Sentry with structured tags so we can group by
  // brand/job and see attempt-count distributions.
  Sentry.withScope((scope) => {
    scope.setTag("queue", QUEUE_NAMES.brandResearch);
    if (job?.id) scope.setTag("job.id", String(job.id));
    if (job?.data?.brandId) scope.setTag("brand.id", String(job.data.brandId));
    scope.setContext("job", {
      id: job?.id,
      brandId: job?.data?.brandId,
      attemptsMade: job?.attemptsMade,
    });
    Sentry.captureException(err ?? new Error("job.failed with no error"));
  });
});

brandResearchWorker.on("stalled", (jobId) => {
  logError("brand-research", "job.stalled", { jobId });
  // Sync Postgres so the UI doesn't sit at "Researching" forever (audit H4).
  // BullMQ will re-queue the job automatically; we just flip our DB state.
  void markJobFailedFromStall(recoveryAdmin, jobId, (msg, extra) =>
    log("recovery", msg.replace(/^recovery\./, ""), extra)
  ).catch((err) => {
    logError("recovery", "stall.unhandled", {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
});

brandResearchWorker.on("error", (err) => {
  logError("brand-research", "worker.error", { error: err.message });
});

// ─── Step 6b: Content Generation worker ──────────────────────────────────────
// Separate BullMQ Worker instance (separate queue name) so brand research and
// content generation can scale independently and one stuck queue doesn't
// stall the other. Same Redis connection + same shutdown sequence.
const contentGenerationWorker = new Worker<ContentGenerationJobData>(
  QUEUE_NAMES.contentGeneration,
  async (job: Job<ContentGenerationJobData>) => {
    log("content-generation", "job.start", {
      jobId: job.id,
      brandId: job.data.brandId,
      platform: job.data.platform,
    });
    const result = await processContentGeneration(job.data, (step, progress) => {
      job.updateProgress(progress).catch(() => {});
      log("content-generation", "step", { jobId: job.id, step, progress });
    });
    log("content-generation", "job.done", {
      jobId: job.id,
      brandId: job.data.brandId,
    });
    return result;
  },
  {
    connection: getRedis(),
    concurrency: workerEnv.WORKER_CONCURRENCY,
  },
);

contentGenerationWorker.on("active", (job) => {
  log("content-generation", "job.active", {
    jobId: job.id,
    brandId: job.data.brandId,
  });
});

contentGenerationWorker.on("completed", (job) => {
  log("content-generation", "job.completed", {
    jobId: job.id,
    brandId: job.data?.brandId,
    durationMs:
      job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null,
  });
});

contentGenerationWorker.on("failed", (job, err) => {
  logError("content-generation", "job.failed", {
    jobId: job?.id,
    brandId: job?.data?.brandId,
    attemptsMade: job?.attemptsMade,
    error: err?.message,
  });
  Sentry.withScope((scope) => {
    scope.setTag("queue", QUEUE_NAMES.contentGeneration);
    if (job?.id) scope.setTag("job.id", String(job.id));
    if (job?.data?.brandId) scope.setTag("brand.id", String(job.data.brandId));
    scope.setContext("job", {
      id: job?.id,
      brandId: job?.data?.brandId,
      platform: job?.data?.platform,
      attemptsMade: job?.attemptsMade,
    });
    Sentry.captureException(err ?? new Error("content job.failed with no error"));
  });
});

contentGenerationWorker.on("error", (err) => {
  logError("content-generation", "worker.error", { error: err.message });
});

// ─── Step 7: Graceful shutdown with hard cap ─────────────────────────────────
// Railway sends SIGTERM during a deploy and waits for a grace period before
// SIGKILL. We try a graceful close (lets active jobs finish) but cap at a
// timeout under Railway's grace window so we always close cleanly rather than
// being hard-killed mid-write.
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 25_000;
let shuttingDown = false;

async function shutdown(signal: string): Promise<never> {
  if (shuttingDown) {
    // Double-signal — operator is impatient, exit immediately.
    logError("worker", "shutdown.double_signal_exit", { signal });
    process.exit(1);
  }
  shuttingDown = true;

  log("worker", "shutdown.start", {
    signal,
    timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  });

  // Race graceful close against a hard deadline. Close both workers in
  // parallel — they share the same Redis connection so a slow brand-research
  // shouldn't block content-generation from finishing.
  const graceful = Promise.all([
    brandResearchWorker.close(),
    contentGenerationWorker.close(),
  ]);
  const deadline = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), GRACEFUL_SHUTDOWN_TIMEOUT_MS)
  );

  const outcome = await Promise.race([
    graceful.then(() => "graceful" as const),
    deadline,
  ]);

  if (outcome === "timeout") {
    logError("worker", "shutdown.force_close", {
      reason: "graceful exceeded timeout",
      timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
    });
    // Force-close: in-flight jobs are abandoned (BullMQ will re-queue via
    // stalled-job detection or attempts).
    await brandResearchWorker.close(true).catch((err) => {
      logError("worker", "shutdown.force_close_failed", { error: err?.message });
    });
  } else {
    log("worker", "shutdown.complete", { signal });
  }

  await disconnectRedis().catch(() => {});
  // Flush any queued Sentry events before exit — otherwise the SDK loses
  // events captured in the last few seconds of the process.
  await flushSentry(2_000);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Unhandled errors should fail loud, not silently keep a half-broken process.
process.on("unhandledRejection", (reason) => {
  logError("worker", "unhandledRejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  Sentry.captureException(
    reason instanceof Error ? reason : new Error(`unhandledRejection: ${String(reason)}`)
  );
});

process.on("uncaughtException", (err) => {
  logError("worker", "uncaughtException", { error: err.message });
  Sentry.captureException(err);
  // Best-effort flush so the crash report makes it to Sentry before we exit.
  // Hard cap at 2s — we'd rather lose a report than hang restart on Railway.
  void flushSentry(2_000).finally(() => process.exit(1));
});

log("worker", "started", {
  concurrency: workerEnv.WORKER_CONCURRENCY,
  model: workerEnv.GEMINI_MODEL,
  geminiTimeoutMs: workerEnv.GEMINI_TIMEOUT_MS,
  shutdownTimeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
});
