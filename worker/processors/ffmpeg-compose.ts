/**
 * ffmpeg-compose processor (ADR-002).
 *
 * Consumes a frozen CompositionPlan (Agents 1-10 output) and runs the
 * worker-side tail of the pipeline:
 *
 *   Agent 11 (compose)  → MP4 on local disk
 *   Agent 12 (QC)       → score + regen requests
 *   [bounded regen]     → re-run the cheap in-worker agents (caption, timing,
 *                         editor) ONCE if QC failed on something we can fix
 *                         here, then re-compose + re-QC
 *   upload              → Cloudflare R2 (primary) → Google Drive (fallback)
 *   asset_history       → one row per scene clip (Agent 6 reads these later)
 *   render_jobs update  → merged_video_url, qc_report, composition_plan,
 *                         pipeline_version, r2_object_key, gdrive_file_id
 *
 * Progress milestones (mapped into render_jobs.progress by worker/index.ts):
 *   5  enqueued/start
 *   15 scenes downloaded
 *   55 first compose done
 *   65 QC done
 *   80 regen+recompose (if any)
 *   90 uploaded
 *   100 done
 */
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase";
import { captureFallback } from "@/lib/observability";
import type { FfmpegComposeJobData } from "@/lib/queue";
import type {
  AgentContext,
  CompositionPlan,
  CompositionResult,
  QCReport,
} from "@/lib/ffmpeg-pipeline/types";
import { normalizeProfile } from "@/lib/ffmpeg-pipeline/render-profile";
import { runFfmpegComposer } from "@/lib/ffmpeg-pipeline/agents/11-ffmpeg-composer";
import { runQualityControl } from "@/lib/ffmpeg-pipeline/agents/12-quality-control";
import { runCaptionCompression } from "@/lib/ffmpeg-pipeline/agents/08-caption-compression";
import { runTiming } from "@/lib/ffmpeg-pipeline/agents/09-timing";
import { runVideoEditor } from "@/lib/ffmpeg-pipeline/agents/10-video-editor";
import { uploadToR2, isR2Configured } from "@/lib/ffmpeg-pipeline/r2";
import { uploadToGDrive } from "@/lib/ffmpeg-pipeline/gdrive";
import { getAccountById, getValidDriveAccessToken } from "@/lib/integrations/accounts";

type Reporter = (step: string, progress: number) => void;

// Which regen owners the WORKER can actually action (cheap, deterministic,
// no candidate-pool/network dependency). multiSourceSearch + diversity regen
// require re-orchestration (the candidate pool isn't in the payload) — we log
// those as unactionable and ship the best-effort artefact rather than failing.
const WORKER_ACTIONABLE = new Set(["captionCompression", "timing", "videoEditor"]);

function makeCtx(plan: CompositionPlan, report: Reporter): AgentContext {
  return {
    renderJobId: plan.renderJobId,
    userId: plan.userId,
    topic: plan.topic,
    brandIndustry: null,
    includeAiScenes: false, // worker never generates AI scenes; that happened in the route
    budgetMode: "standard",
    log: (msg, extra) => {
      // Bridge agent logs to the worker's structured logger via Sentry
      // breadcrumb. The processor's own report() handles progress.
      void msg;
      void extra;
    },
  };
}

/**
 * Re-run the in-worker-actionable agents to repair a failed plan, returning a
 * new plan. Only the agents named in `owners` are re-run; others are left
 * untouched.
 */
async function regenerate(
  plan: CompositionPlan,
  owners: Set<string>,
  ctx: AgentContext,
): Promise<CompositionPlan> {
  const scenes = plan.scenes.map((s) => s.plan);

  let captions = plan.scenes.map((s) => s.caption);
  if (owners.has("captionCompression")) {
    const out = await runCaptionCompression({ scenes }, ctx);
    captions = out.captions;
  }

  let timings = plan.scenes.map((s) => s.timing);
  if (owners.has("timing")) {
    const out = await runTiming(
      { scenes, narrationDurationSec: plan.output.durationMs / 1000 },
      ctx,
    );
    timings = out.perScene;
  }

  let edits = plan.scenes.map((s) => s.edit);
  if (owners.has("videoEditor")) {
    const out = await runVideoEditor(
      {
        scenes,
        timings,
        emotionalArc: plan.artifacts.strategy.emotionalArc,
        baseStyle: scenes[0]?.visualStyle ?? "cinematic",
      },
      ctx,
    );
    edits = out.decisions;
  }

  // Reassemble the plan with the repaired components, keyed by sceneId.
  const captionById = new Map(captions.map((c) => [c.sceneId, c]));
  const timingById = new Map(timings.map((t) => [t.sceneId, t]));
  const editById = new Map(edits.map((e) => [e.sceneId, e]));

  return {
    ...plan,
    scenes: plan.scenes.map((s) => ({
      ...s,
      caption: captionById.get(s.plan.sceneId) ?? s.caption,
      timing: timingById.get(s.plan.sceneId) ?? s.timing,
      edit: editById.get(s.plan.sceneId) ?? s.edit,
    })),
  };
}

/**
 * Upload the rendered MP4 to R2 (primary) or Google Drive (fallback).
 * Returns the public URL + which storage was used.
 */
async function uploadResult(
  plan: CompositionPlan,
  localPath: string,
  connectedAccountId: string | null | undefined,
  ctx: AgentContext,
): Promise<{ url: string; r2Key: string | null; gdriveId: string | null }> {
  const bytes = await fs.readFile(localPath);
  const objectKey = `${plan.userId}/${plan.renderJobId}/${plan.version}.mp4`;

  if (isR2Configured()) {
    const r2 = await uploadToR2(objectKey, bytes, "video/mp4");
    return { url: r2.publicUrl, r2Key: r2.objectKey, gdriveId: null };
  }

  if (connectedAccountId) {
    // P1 token-threading: fetch the account + decrypt the OAuth token here in
    // the worker (no plaintext token in the queue payload). getValidDrive-
    // AccessToken refreshes if needed.
    ctx.log("ffmpeg-compose.r2_unconfigured_using_gdrive");
    const account = await getAccountById(connectedAccountId);
    if (!account) {
      throw new Error(`Drive connected_account ${connectedAccountId} not found`);
    }
    const accessToken = await getValidDriveAccessToken(account);
    const folderId =
      (account.metadata?.folders as Record<string, string> | undefined)?.videos ??
      process.env.GDRIVE_FOLDER_ID ??
      null;
    const drive = await uploadToGDrive({
      accessToken,
      fileName: `ottoflow-${plan.renderJobId}.mp4`,
      contentType: "video/mp4",
      body: bytes,
      folderId,
    });
    return {
      url: drive.webViewLink ?? `https://drive.google.com/file/d/${drive.fileId}/view`,
      r2Key: null,
      gdriveId: drive.fileId,
    };
  }

  throw new Error(
    "No storage configured: set R2_* env (primary) or connect Google Drive (fallback)",
  );
}

/**
 * Write one asset_history row per selected scene clip so Agent 6 (Diversity)
 * penalises repeats on the user's NEXT video. Best-effort — never blocks the
 * job. The unique partial index on (render_job_id, source, source_id) makes a
 * retry idempotent.
 */
async function writeAssetHistory(
  admin: ReturnType<typeof createAdminClient>,
  plan: CompositionPlan,
): Promise<void> {
  const rows = plan.scenes.map((s) => ({
    user_id: plan.userId,
    source: s.clip.source,
    source_id: s.clip.sourceId,
    asset_url: s.clip.url,
    render_job_id: plan.renderJobId,
    topic: plan.topic,
  }));
  // upsert ignoring conflicts on the unique index (retry-safe).
  await admin
    .from("asset_history")
    .upsert(rows, { onConflict: "render_job_id,source,source_id", ignoreDuplicates: true });
}

export async function processFfmpegCompose(
  data: FfmpegComposeJobData,
  report: Reporter,
): Promise<{ ok: true; mergedUrl: string; qcScore: number }> {
  const admin = createAdminClient();
  let plan = data.plan;

  // Video Quality V2 — resolve the per-render presentation profile from
  // render_context (set at job creation by the generate route). Populated HERE,
  // not in the frozen Agents 1-10 plan, so presentation flags resolve per job
  // with zero change to scene generation. Absent/older jobs / invalid value →
  // renderProfile stays undefined → Legacy (byte-identical). Never global.
  if (!plan.renderProfile) {
    try {
      const { data: jobRow } = await admin
        .from("render_jobs")
        .select("render_context")
        .eq("id", plan.renderJobId)
        .maybeSingle();
      const rc = jobRow?.render_context as { renderProfile?: unknown; textOverlay?: unknown } | null;
      const rp = normalizeProfile(rc?.renderProfile ?? null);
      if (rp) plan = { ...plan, renderProfile: rp };
      // Creative OS M2 — "No text": only the explicit false suppresses captions;
      // absent/true leaves the plan untouched (byte-identical default).
      if (rc?.textOverlay === false) plan = { ...plan, textOverlay: false };
    } catch (err) {
      // Best-effort: a lookup failure must never break a render — fall through
      // to Legacy (undefined profile). Presentation is advisory, not critical.
      captureFallback("ffmpeg-compose.render_profile_lookup_failed", err, {
        renderJobId: plan.renderJobId,
      });
    }
  }

  const ctx = makeCtx(plan, report);

  const workDir = path.join(tmpdir(), `compose-${plan.renderJobId}-${randomUUID()}`);

  await admin
    .from("render_jobs")
    .update({ merge_status: "merging", pipeline_version: plan.version })
    .eq("id", plan.renderJobId);
  report("compose", 5);

  try {
    // ─── Agent 11: first compose ───────────────────────────────────────────
    let result: CompositionResult = await runFfmpegComposer({ plan, workDir }, ctx);
    report("compose", 55);

    // ─── Agent 12: QC ──────────────────────────────────────────────────────
    let qc: QCReport = await runQualityControl({ plan, result }, ctx);
    report("qc", 65);

    // ─── Bounded regen (1 pass, worker-actionable agents only) ─────────────
    if (!qc.passed) {
      const actionable = new Set(
        qc.regenerateRequested.filter((a) => WORKER_ACTIONABLE.has(a)),
      );
      if (actionable.size > 0) {
        report("regen", 70);
        plan = await regenerate(plan, actionable, ctx);
        // Re-compose into a fresh subdir so we don't clobber the first output
        // while the file is still referenced.
        const regenDir = path.join(workDir, "regen");
        result = await runFfmpegComposer({ plan, workDir: regenDir }, ctx);
        qc = await runQualityControl({ plan, result }, ctx);
        report("regen", 80);
      } else if (qc.regenerateRequested.length > 0) {
        // Requested regen we can't action in the worker (search/diversity).
        // Ship best-effort + record so analytics can flag it.
        captureFallback(
          "ffmpeg-compose.regen_unactionable",
          new Error(`QC ${qc.score} requested non-worker regen: ${qc.regenerateRequested.join(", ")}`),
          { renderJobId: plan.renderJobId, score: qc.score },
        );
      }
    }

    // ─── Upload ────────────────────────────────────────────────────────────
    const upload = await uploadResult(plan, result.localPath, data.connectedAccountId, ctx);
    report("upload", 90);

    // ─── asset_history (best-effort) ─────────────────────────────────────────
    try {
      await writeAssetHistory(admin, plan);
    } catch (err) {
      captureFallback("ffmpeg-compose.asset_history_failed", err, {
        renderJobId: plan.renderJobId,
      });
    }

    // ─── render_jobs final update ────────────────────────────────────────────
    await admin
      .from("render_jobs")
      .update({
        merge_status: qc.passed ? "done" : "done", // we ship even on soft-fail
        merged_video_url: upload.url,
        merge_error: qc.passed ? null : `QC ${qc.score}/10 (shipped best-effort): ${qc.issues.map((i) => i.code).join(", ")}`,
        qc_report: qc as unknown as Record<string, unknown>,
        composition_plan: plan as unknown as Record<string, unknown>,
        pipeline_version: plan.version,
        r2_object_key: upload.r2Key,
        gdrive_file_id: upload.gdriveId,
      })
      .eq("id", plan.renderJobId);
    report("done", 100);

    return { ok: true, mergedUrl: upload.url, qcScore: qc.score };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("render_jobs")
      .update({ merge_status: "failed", merge_error: message.slice(0, 1000) })
      .eq("id", plan.renderJobId);
    throw err;
  } finally {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
