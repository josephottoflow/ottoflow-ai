/**
 * POST /api/video/jobs/[jobId]/scene/[sceneId]/replace  (Sprint 39.2)
 *
 * Replaces ONE scene's visual with a customer-chosen stock clip, then re-renders
 * the job REUSING every other asset. No storyboard/script/narration/caption/
 * timing regeneration — those live in the unchanged video_strategy.
 *
 * How it reuses the existing architecture (no duplicate logic):
 *   - Reads the render context persisted at approve (migration 031) so the
 *     re-render uses the SAME platform/aspect/mode/resolution/branding/source.
 *   - Re-enqueues the SAME scene-generation job with a per-scene `sceneOverrides`
 *     entry. The worker's resume reuses every cached scene; the overridden scene
 *     bypasses cache and uses the chosen clip (copied to R2 worker-side — Vercel
 *     has no R2 creds, so the copy intentionally happens in the worker).
 *
 * Returns 409 if the job predates migration 031 (no render_context) — honest
 * degradation, never a silent wrong-settings re-render.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { captureFallback } from "@/lib/observability";
import { sceneGenerationQueue, type SceneGenerationJobData } from "@/lib/queue";
import type { VideoStrategy } from "@/lib/ffmpeg-pipeline/types";

export const runtime = "nodejs";

const CandidateSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  url: z.string().url(),
  provider: z.string().min(1).default("pexels"),
  durationSec: z.number().positive().max(90),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  attribution: z.string().nullable().optional(),
});
const BodySchema = z.object({ candidate: CandidateSchema });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string; sceneId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId, sceneId } = await params;
  const sceneIdNum = Number(sceneId);
  if (!Number.isInteger(sceneIdNum)) {
    return NextResponse.json({ error: "Invalid sceneId" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid candidate" }, { status: 400 });
  }
  const c = parsed.data.candidate;

  const admin = createAdminClient();

  const { data: job, error: jobErr } = await admin
    .from("render_jobs")
    .select("id, user_id, render_context, video_strategy")
    .eq("id", jobId)
    .eq("user_id", userId)
    .single();
  if (jobErr || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const ctx = job.render_context as Record<string, unknown> | null;
  if (!ctx) {
    return NextResponse.json(
      {
        error:
          "This video predates scene replacement. Generate a new video to enable Replace Visual.",
      },
      { status: 409 },
    );
  }

  const strategy = job.video_strategy as VideoStrategy | null;
  if (!strategy?.scenes?.some((s) => s.sceneId === sceneIdNum)) {
    return NextResponse.json({ error: "Scene not found" }, { status: 404 });
  }

  // Rebuild the EXACT scene-gen payload (persisted context + recoverable fields)
  // and attach the one-scene override. Worker resume reuses every other scene.
  const payload: SceneGenerationJobData = {
    ...(ctx as Partial<SceneGenerationJobData>),
    renderJobId: jobId,
    userId,
    strategy,
    sceneOverrides: {
      [sceneIdNum]: {
        url: c.url,
        provider: c.provider,
        durationSec: c.durationSec,
        width: c.width,
        height: c.height,
        sourceId: c.id ?? null,
        attribution: c.attribution ?? null,
      },
    },
  } as SceneGenerationJobData;

  try {
    // Reset the row so the UI reflects the re-render; keep the same DB row.
    await admin
      .from("render_jobs")
      .update({ status: "queued", progress: 0, merge_status: "pending", merge_error: null })
      .eq("id", jobId);

    // Fresh BullMQ job id (the original used jobId, which would dedupe).
    await sceneGenerationQueue().add("scene-gen", payload, {
      attempts: 1,
      jobId: `${jobId}:replace:${Date.now()}`,
    });

    return NextResponse.json({ ok: true, sceneId: sceneIdNum });
  } catch (err) {
    captureFallback("video.scene.replace.failed", err, { jobId, sceneId: sceneIdNum, userId });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Replace failed" },
      { status: 500 },
    );
  }
}
