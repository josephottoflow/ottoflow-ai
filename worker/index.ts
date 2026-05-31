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
 *   5. construct Worker and register signal handlers
 *
 * Validated env: see src/lib/worker-env.ts.
 */

// ─── Step 1: load .env files (Railway uses platform vars, so these no-op there) ─
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

// ─── Step 2: validate worker env BEFORE importing anything that reads env ────
import { workerEnv } from "@/lib/worker-env";

// ─── Step 3: real imports (these may read process.env at module load) ────────
import { Worker, type Job } from "bullmq";
import {
  getRedis,
  attachRedisLogger,
  disconnectRedis,
  QUEUE_NAMES,
  type BrandResearchJobData,
} from "@/lib/queue";
import { processBrandResearch } from "./processors/brand-research";

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

// ─── Step 5: Brand Research worker ───────────────────────────────────────────
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
});

brandResearchWorker.on("stalled", (jobId) => {
  logError("brand-research", "job.stalled", { jobId });
});

brandResearchWorker.on("error", (err) => {
  logError("brand-research", "worker.error", { error: err.message });
});

// ─── Step 6: Graceful shutdown with hard cap ─────────────────────────────────
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

  // Race graceful close against a hard deadline.
  const graceful = brandResearchWorker.close();
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
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Unhandled errors should fail loud, not silently keep a half-broken process.
process.on("unhandledRejection", (reason) => {
  logError("worker", "unhandledRejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on("uncaughtException", (err) => {
  logError("worker", "uncaughtException", { error: err.message });
  // Exit so the orchestrator restarts us into a clean state.
  process.exit(1);
});

log("worker", "started", {
  concurrency: workerEnv.WORKER_CONCURRENCY,
  model: workerEnv.GEMINI_MODEL,
  geminiTimeoutMs: workerEnv.GEMINI_TIMEOUT_MS,
  shutdownTimeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
});
