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
  type VideoMergeJobData,
  type FfmpegComposeJobData,
  type CreativeGenerationJobData,
  type DriveSyncJobData,
  type PublishJobData,
  publishQueue,
} from "@/lib/queue";
import { createAdminClient } from "@/lib/supabase";
import { processBrandResearch } from "./processors/brand-research";
import { processContentGeneration } from "./processors/content-generation";
import { processVideoMerge } from "./processors/video-merge";
import { processFfmpegCompose } from "./processors/ffmpeg-compose";
import { processCreativeGeneration } from "./processors/creative-generation";
import { processDriveSync } from "./processors/drive-sync";
import { processPublish } from "./processors/publish";
import { isPublishingEnabled } from "@/lib/publishing/flags";
import { claimDueScheduledJobs, reapStuckPublishingJobs, getPublishStatusCounts } from "@/lib/publishing/jobs";
import { withLock, SCHEDULER_LOCK_KEY, REAPER_LOCK_KEY } from "@/lib/publishing/lock";
import { recoverStuckJobsAtBoot, markJobFailedFromStall, schedulePeriodicSweep } from "./recovery";

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

// ─── B1.R7: Periodic sweep across all job types ─────────────────────────────
// Every 5 min: catch brand_research, content_generation, and render_jobs
// stuck in 'running'/'merging' state. Each tick emits a structured log
// line consumed by the BETA_READINESS dashboards.
const periodicSweepHandle = schedulePeriodicSweep(recoveryAdmin, (msg, extra) =>
  log("recovery", msg.replace(/^recovery\./, ""), extra),
);

// ─── Video Pipeline v2 F2: scene-provider visibility ────────────────────────
// Surface scene-gen capability at boot so the operator can tell at a glance
// whether video-merge jobs will produce real multi-scene composition or fall
// back to single-clip Pexels (the root cause of the timeline audit's P0).
//
// We deliberately do NOT refuse boot when all three are unset — the worker
// also serves brand-research + content-generation, which don't need these
// keys. Instead we log a structured WARN that monitoring/alerts can latch on
// to. See docs/VIDEO_TIMELINE_AUDIT.md F1/F2.
{
  const runwayCfg = !!workerEnv.RUNWAYML_API_SECRET && !!workerEnv.PEXELS_API_KEY;
  const lumaCfg = !!workerEnv.LUMA_API_KEY;
  const pexelsCfg = !!workerEnv.PEXELS_API_KEY;
  const anyCfg = runwayCfg || lumaCfg || pexelsCfg;
  const payload = {
    runway: runwayCfg,
    luma: lumaCfg,
    pexels: pexelsCfg,
    sceneGenAvailable: anyCfg,
  };
  if (!anyCfg) {
    logError("worker", "scene_providers.all_unset", {
      ...payload,
      hint:
        "video-merge jobs will fall back to a single Pexels clip prefetched on Vercel " +
        "for every render. Set RUNWAYML_API_SECRET (+PEXELS_API_KEY for the seed image), " +
        "LUMA_API_KEY, or PEXELS_API_KEY in Railway → Variables to enable real multi-scene " +
        "composition.",
    });
    Sentry.captureMessage("scene-providers all unset on worker", { level: "warning" });
  } else {
    log("worker", "scene_providers.configured", payload);
  }
}

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

// ─── Step 6c: Video Merge worker ─────────────────────────────────────────────
// Third Worker instance for the post-pipeline ffmpeg merge that turns the
// 3 separate assets (Pexels MP4 + ElevenLabs narration + Jamendo music) into
// a single downloadable MP4 in Supabase Storage. CPU-heavy + I/O bound, so
// runs on its own concurrency budget.
const videoMergeWorker = new Worker<VideoMergeJobData>(
  QUEUE_NAMES.videoMerge,
  async (job: Job<VideoMergeJobData>) => {
    log("video-merge", "job.start", {
      jobId: job.id,
      renderJobId: job.data.renderJobId,
      hasNarration: !!job.data.audioDataUrl,
      hasMusic: !!job.data.musicUrl,
    });
    const result = await processVideoMerge(job.data, (step, progress) => {
      job.updateProgress(progress).catch(() => {});
      // Video Pipeline v2 P0 — push progress into render_jobs.progress so
      // UI Realtime subscribers see incremental updates (5/10/28/35/50/80/100)
      // instead of a frozen row between merge_status='merging' (at start) and
      // merge_status='done' (at end, 100-150s later). Best-effort: never fail
      // the merge if this write fails. Reuses recoveryAdmin (module-scope
      // service-role client) — RLS is bypassed intentionally since the worker
      // acts on behalf of users without their session token.
      void recoveryAdmin
        .from("render_jobs")
        .update({ progress })
        .eq("id", job.data.renderJobId)
        .then(
          ({ error }) => {
            if (error) {
              log("video-merge", "progress.write_failed", {
                jobId: job.id,
                renderJobId: job.data.renderJobId,
                progress,
                error: error.message,
              });
            }
          },
          (err: unknown) => {
            log("video-merge", "progress.write_failed", {
              jobId: job.id,
              renderJobId: job.data.renderJobId,
              progress,
              error: err instanceof Error ? err.message : String(err),
            });
          },
        );
      log("video-merge", "step", { jobId: job.id, step, progress });
    });
    log("video-merge", "job.done", {
      jobId: job.id,
      renderJobId: job.data.renderJobId,
      mergedUrl: result.mergedUrl,
    });
    return result;
  },
  {
    connection: getRedis(),
    // ffmpeg is heavy — cap merges below the general WORKER_CONCURRENCY so
    // one runaway render doesn't starve the lighter brand/content queues.
    concurrency: Math.max(1, Math.floor(workerEnv.WORKER_CONCURRENCY / 2)),
  },
);

videoMergeWorker.on("active", (job) => {
  log("video-merge", "job.active", {
    jobId: job.id,
    renderJobId: job.data.renderJobId,
  });
});

videoMergeWorker.on("completed", (job) => {
  log("video-merge", "job.completed", {
    jobId: job.id,
    renderJobId: job.data?.renderJobId,
    durationMs:
      job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null,
  });
});

videoMergeWorker.on("failed", (job, err) => {
  logError("video-merge", "job.failed", {
    jobId: job?.id,
    renderJobId: job?.data?.renderJobId,
    attemptsMade: job?.attemptsMade,
    error: err?.message,
  });
  Sentry.withScope((scope) => {
    scope.setTag("queue", QUEUE_NAMES.videoMerge);
    if (job?.id) scope.setTag("job.id", String(job.id));
    if (job?.data?.renderJobId)
      scope.setTag("render_job.id", String(job.data.renderJobId));
    scope.setContext("job", {
      id: job?.id,
      renderJobId: job?.data?.renderJobId,
      attemptsMade: job?.attemptsMade,
    });
    Sentry.captureException(err ?? new Error("video-merge job.failed with no error"));
  });
});

videoMergeWorker.on("error", (err) => {
  logError("video-merge", "worker.error", { error: err.message });
});

// ─── Step 6d: FFmpeg Compose worker (ADR-002) ────────────────────────────────
// Fourth Worker instance for the multi-agent FFmpeg pipeline. Consumes a
// frozen CompositionPlan and runs Agents 11 (compose) + 12 (QC) + storage
// upload. No Chrome/Remotion — pure ffmpeg, so RAM stays well under the
// worker cap that broke the Remotion path. CPU-heavy + I/O bound; shares the
// video-merge concurrency budget (half of WORKER_CONCURRENCY).
const ffmpegComposeWorker = new Worker<FfmpegComposeJobData>(
  QUEUE_NAMES.ffmpegCompose,
  async (job: Job<FfmpegComposeJobData>) => {
    log("ffmpeg-compose", "job.start", {
      jobId: job.id,
      renderJobId: job.data.plan.renderJobId,
      scenes: job.data.plan.scenes.length,
      version: job.data.plan.version,
    });
    const result = await processFfmpegCompose(job.data, (step, progress) => {
      job.updateProgress(progress).catch(() => {});
      // Mirror progress into render_jobs.progress for UI Realtime (same
      // pattern as video-merge). Best-effort; never fail the compose on a
      // progress write error.
      void recoveryAdmin
        .from("render_jobs")
        .update({ progress })
        .eq("id", job.data.plan.renderJobId)
        .then(
          ({ error }) => {
            if (error) {
              log("ffmpeg-compose", "progress.write_failed", {
                jobId: job.id,
                renderJobId: job.data.plan.renderJobId,
                progress,
                error: error.message,
              });
            }
          },
          (err: unknown) => {
            log("ffmpeg-compose", "progress.write_failed", {
              jobId: job.id,
              renderJobId: job.data.plan.renderJobId,
              progress,
              error: err instanceof Error ? err.message : String(err),
            });
          },
        );
      log("ffmpeg-compose", "step", { jobId: job.id, step, progress });
    });
    log("ffmpeg-compose", "job.done", {
      jobId: job.id,
      renderJobId: job.data.plan.renderJobId,
      mergedUrl: result.mergedUrl,
      qcScore: result.qcScore,
    });
    return result;
  },
  {
    connection: getRedis(),
    concurrency: Math.max(1, Math.floor(workerEnv.WORKER_CONCURRENCY / 2)),
  },
);

ffmpegComposeWorker.on("active", (job) => {
  log("ffmpeg-compose", "job.active", {
    jobId: job.id,
    renderJobId: job.data.plan.renderJobId,
  });
});

ffmpegComposeWorker.on("completed", (job) => {
  log("ffmpeg-compose", "job.completed", {
    jobId: job.id,
    renderJobId: job.data?.plan.renderJobId,
    durationMs:
      job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null,
  });
});

ffmpegComposeWorker.on("failed", (job, err) => {
  logError("ffmpeg-compose", "job.failed", {
    jobId: job?.id,
    renderJobId: job?.data?.plan.renderJobId,
    attemptsMade: job?.attemptsMade,
    error: err?.message,
  });
  Sentry.withScope((scope) => {
    scope.setTag("queue", QUEUE_NAMES.ffmpegCompose);
    if (job?.id) scope.setTag("job.id", String(job.id));
    if (job?.data?.plan.renderJobId)
      scope.setTag("render_job.id", String(job.data.plan.renderJobId));
    scope.setContext("job", {
      id: job?.id,
      renderJobId: job?.data?.plan.renderJobId,
      attemptsMade: job?.attemptsMade,
    });
    Sentry.captureException(err ?? new Error("ffmpeg-compose job.failed with no error"));
  });
});

ffmpegComposeWorker.on("error", (err) => {
  logError("ffmpeg-compose", "worker.error", { error: err.message });
});

// ─── Step 6e: Creative Generation worker (Creative Orchestrator Phase C) ──────
// Fifth Worker instance. Consumes an APPROVED creative brief → Imagen
// background (validated) + deterministic sharp composite → storage. Imagen +
// sharp are lighter than ffmpeg, but image work is still CPU/IO-bound, so it
// shares the reduced (half) concurrency budget with the video queues.
const creativeGenerationWorker = new Worker<CreativeGenerationJobData>(
  QUEUE_NAMES.creativeGeneration,
  async (job: Job<CreativeGenerationJobData>) => {
    log("creative-generation", "job.start", {
      jobId: job.id,
      creativeId: job.data.creativeId,
      brandId: job.data.brandId,
      regen: !!job.data.regen,
    });
    const result = await processCreativeGeneration(job.data, (step, progress) => {
      job.updateProgress(progress).catch(() => {});
      log("creative-generation", "step", { jobId: job.id, step, progress });
    });
    log("creative-generation", "job.done", {
      jobId: job.id,
      creativeId: job.data.creativeId,
      imageUrl: result.imageUrl,
    });
    return result;
  },
  {
    connection: getRedis(),
    concurrency: Math.max(1, Math.floor(workerEnv.WORKER_CONCURRENCY / 2)),
  },
);

creativeGenerationWorker.on("active", (job) => {
  log("creative-generation", "job.active", {
    jobId: job.id,
    creativeId: job.data.creativeId,
  });
});

creativeGenerationWorker.on("completed", (job) => {
  log("creative-generation", "job.completed", {
    jobId: job.id,
    creativeId: job.data?.creativeId,
    durationMs:
      job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null,
  });
});

creativeGenerationWorker.on("failed", (job, err) => {
  logError("creative-generation", "job.failed", {
    jobId: job?.id,
    creativeId: job?.data?.creativeId,
    attemptsMade: job?.attemptsMade,
    error: err?.message,
  });
  Sentry.withScope((scope) => {
    scope.setTag("queue", QUEUE_NAMES.creativeGeneration);
    if (job?.id) scope.setTag("job.id", String(job.id));
    if (job?.data?.creativeId) scope.setTag("creative.id", String(job.data.creativeId));
    scope.setContext("job", {
      id: job?.id,
      creativeId: job?.data?.creativeId,
      brandId: job?.data?.brandId,
      attemptsMade: job?.attemptsMade,
    });
    Sentry.captureException(err ?? new Error("creative-generation job.failed with no error"));
  });
});

creativeGenerationWorker.on("error", (err) => {
  logError("creative-generation", "worker.error", { error: err.message });
});

// Sixth Worker instance (Phase 3 / P1). Copies a generated artifact into the
// user's connected Google Drive. Light network I/O (download + upload) — shares
// the reduced (half) concurrency budget. The OAuth token is fetched + decrypted
// inside the processor; it never travels through the queue payload.
const driveSyncWorker = new Worker<DriveSyncJobData>(
  QUEUE_NAMES.driveSync,
  async (job: Job<DriveSyncJobData>) => {
    log("drive-sync", "job.start", {
      jobId: job.id,
      artifactType: job.data.artifactType,
      artifactId: job.data.artifactId,
    });
    const result = await processDriveSync(job.data, (step, progress) => {
      job.updateProgress(progress).catch(() => {});
      log("drive-sync", "step", { jobId: job.id, step, progress });
    });
    log("drive-sync", "job.done", { jobId: job.id, fileId: result.fileId });
    return result;
  },
  {
    connection: getRedis(),
    concurrency: Math.max(1, Math.floor(workerEnv.WORKER_CONCURRENCY / 2)),
  },
);

driveSyncWorker.on("failed", (job, err) => {
  logError("drive-sync", "job.failed", {
    jobId: job?.id,
    artifactType: job?.data?.artifactType,
    artifactId: job?.data?.artifactId,
    attemptsMade: job?.attemptsMade,
    error: err?.message,
  });
  Sentry.withScope((scope) => {
    scope.setTag("queue", QUEUE_NAMES.driveSync);
    if (job?.id) scope.setTag("job.id", String(job.id));
    Sentry.captureException(err);
  });
});

driveSyncWorker.on("error", (err) => {
  logError("drive-sync", "worker.error", { error: err.message });
});

// Seventh Worker instance (PUB-1) — publish jobs. Registered ONLY when
// PUBLISHING_ENABLED, so the queue idles (dark-launch) otherwise. PUB-1 posts
// nothing live: the processor marks jobs needs_review (no provider.publish).
// A DB-driven scheduler sweep (every 30s) claims due scheduled jobs
// (scheduled→queued) and enqueues them; no BullMQ delayed jobs.
let publishWorker: Worker<PublishJobData> | null = null;
let publishSchedulerHandle: ReturnType<typeof setInterval> | null = null;
let publishReaperHandle: ReturnType<typeof setInterval> | null = null;

const SCHED_LOCK_MS = Number(process.env.PUBLISH_SCHEDULER_LOCK_MS ?? 25_000);
const REAPER_INTERVAL_MS = Number(process.env.PUBLISH_REAPER_INTERVAL_MS ?? 300_000);
const REAPER_LOCK_MS = Number(process.env.PUBLISH_REAPER_LOCK_MS ?? 120_000);
const ORPHAN_THRESHOLD_MS = Number(process.env.PUBLISH_ORPHAN_THRESHOLD_MS ?? 900_000);

if (isPublishingEnabled()) {
  publishWorker = new Worker<PublishJobData>(
    QUEUE_NAMES.publish,
    async (job: Job<PublishJobData>) => {
      log("publish", "job.start", { jobId: job.id, publishJobId: job.data.publishJobId });
      const result = await processPublish(job.data, (step, progress) => {
        job.updateProgress(progress).catch(() => {});
        log("publish", "step", { jobId: job.id, step, progress });
      });
      log("publish", "job.done", { jobId: job.id, status: result.status });
      return result;
    },
    {
      connection: getRedis(),
      concurrency: Math.max(1, Math.floor(workerEnv.WORKER_CONCURRENCY / 2)),
    },
  );

  publishWorker.on("failed", (job, err) => {
    logError("publish", "job.failed", {
      jobId: job?.id,
      publishJobId: job?.data?.publishJobId,
      attemptsMade: job?.attemptsMade,
      error: err?.message,
    });
    Sentry.withScope((scope) => {
      scope.setTag("queue", QUEUE_NAMES.publish);
      if (job?.id) scope.setTag("job.id", String(job.id));
      Sentry.captureException(err);
    });
  });
  publishWorker.on("error", (err) => {
    logError("publish", "worker.error", { error: err.message });
  });

  // DB-driven scheduler (single-instance via Redis lock): claim due scheduled
  // jobs and enqueue them (attempts:1). If another replica holds the lock, this
  // tick is a no-op.
  publishSchedulerHandle = setInterval(() => {
    const started = Date.now();
    void withLock(SCHEDULER_LOCK_KEY, SCHED_LOCK_MS, async () => {
      const ids = await claimDueScheduledJobs();
      for (const id of ids) {
        await publishQueue().add("publish", { publishJobId: id }, { attempts: 1, jobId: id });
      }
      return ids.length;
    })
      .then((claimed) => {
        if (claimed === null) return; // lock held elsewhere
        if (claimed > 0) {
          log("publish", "scheduler.swept", { claimed, durationMs: Date.now() - started });
        }
      })
      .catch((err: unknown) => {
        logError("publish", "scheduler.error", { error: err instanceof Error ? err.message : String(err) });
      });
  }, 30_000);

  // Reaper (single-instance): recover jobs stuck in 'publishing' past the
  // orphan threshold → needs_review (never re-posts). Emits status metrics.
  publishReaperHandle = setInterval(() => {
    const started = Date.now();
    void withLock(REAPER_LOCK_KEY, REAPER_LOCK_MS, async () => {
      const { found, reaped } = await reapStuckPublishingJobs(ORPHAN_THRESHOLD_MS);
      const counts = await getPublishStatusCounts();
      return { found, reaped, counts };
    })
      .then((res) => {
        if (res === null) return; // lock held elsewhere
        log("publish", "reaper.swept", { found: res.found, reaped: res.reaped, durationMs: Date.now() - started });
        log("publish", "metrics", res.counts);
      })
      .catch((err: unknown) => {
        logError("publish", "reaper.error", { error: err instanceof Error ? err.message : String(err) });
      });
  }, REAPER_INTERVAL_MS);

  log("publish", "registered", {
    schedulerIntervalMs: 30_000,
    reaperIntervalMs: REAPER_INTERVAL_MS,
    orphanThresholdMs: ORPHAN_THRESHOLD_MS,
  });
} else {
  log("publish", "disabled", { reason: "PUBLISHING_ENABLED not set" });
}

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

  // Stop the periodic recovery sweep so it doesn't fire during shutdown.
  clearInterval(periodicSweepHandle);
  if (publishSchedulerHandle) clearInterval(publishSchedulerHandle);
  if (publishReaperHandle) clearInterval(publishReaperHandle);

  // Race graceful close against a hard deadline. Close all workers in
  // parallel — they share the same Redis connection so a slow brand-research
  // shouldn't block content-generation or video-merge from finishing.
  const graceful = Promise.all([
    brandResearchWorker.close(),
    contentGenerationWorker.close(),
    videoMergeWorker.close(),
    ffmpegComposeWorker.close(),
    creativeGenerationWorker.close(),
    driveSyncWorker.close(),
    ...(publishWorker ? [publishWorker.close()] : []),
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
    await Promise.all([
      brandResearchWorker.close(true).catch((err) => {
        logError("worker", "shutdown.force_close_failed", { error: err?.message, queue: "brand-research" });
      }),
      contentGenerationWorker.close(true).catch((err) => {
        logError("worker", "shutdown.force_close_failed", { error: err?.message, queue: "content-generation" });
      }),
      videoMergeWorker.close(true).catch((err) => {
        logError("worker", "shutdown.force_close_failed", { error: err?.message, queue: "video-merge" });
      }),
      ffmpegComposeWorker.close(true).catch((err) => {
        logError("worker", "shutdown.force_close_failed", { error: err?.message, queue: "ffmpeg-compose" });
      }),
      creativeGenerationWorker.close(true).catch((err) => {
        logError("worker", "shutdown.force_close_failed", { error: err?.message, queue: "creative-generation" });
      }),
      driveSyncWorker.close(true).catch((err) => {
        logError("worker", "shutdown.force_close_failed", { error: err?.message, queue: "drive-sync" });
      }),
      ...(publishWorker
        ? [
            publishWorker.close(true).catch((err) => {
              logError("worker", "shutdown.force_close_failed", { error: err?.message, queue: "publish" });
            }),
          ]
        : []),
    ]);
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
