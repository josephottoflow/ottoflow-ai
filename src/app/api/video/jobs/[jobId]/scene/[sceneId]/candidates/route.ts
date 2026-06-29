/**
 * POST /api/video/jobs/[jobId]/scene/[sceneId]/candidates  (Sprint 39, Phase 2)
 *
 * Returns the RANKED stock-clip candidates for ONE scene — the pool the render
 * engine would pick from — so the Scene Inspector can show alternatives + why.
 *
 * REUSE, not rebuild: it calls searchStockVideoCandidates(), which runs the
 * SAME buildQueries → searchOnce → filterUsable → pickBestFile path as the
 * render's findStockVideoByPrompt(). So candidates shown == what the renderer
 * chooses among. SEARCH ONLY — no download, no R2 copy, no FFmpeg, no enqueue,
 * no storyboard/script regeneration. Honest signals only (no fabricated agent
 * scores: the modal's render path is the Pexels provider, not Agents 03–07).
 *
 * Excludes Pexels ids already used by other scenes of this job → no duplicate
 * clips (Phase 8). Scene prompt is read from the job's stored video_strategy;
 * nothing is mutated here.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { captureFallback } from "@/lib/observability";
import { searchStockVideoCandidates, PexelsNotConfiguredError } from "@/lib/pexels";
import type { VideoStrategy } from "@/lib/ffmpeg-pipeline/types";

export const runtime = "nodejs";

const BodySchema = z.object({
  aspect: z.enum(["9:16", "16:9", "1:1"]).optional(),
  limit: z.number().int().min(1).max(16).optional(),
});

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

  const body = BodySchema.safeParse(await req.json().catch(() => ({})));
  const aspect = body.success ? body.data.aspect : undefined;
  const limit = body.success ? body.data.limit ?? 8 : 8;

  const admin = createAdminClient();

  // Ownership-scoped fetch (404 on miss to avoid existence leak).
  const { data: job, error: jobErr } = await admin
    .from("render_jobs")
    .select("id, user_id, video_strategy, prompt")
    .eq("id", jobId)
    .eq("user_id", userId)
    .single();
  if (jobErr || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const strategy = job.video_strategy as VideoStrategy | null;
  const scene = strategy?.scenes?.find((s) => s.sceneId === sceneIdNum);
  if (!scene) {
    return NextResponse.json({ error: "Scene not found" }, { status: 404 });
  }

  // Pexels ids already used by this job's scenes → exclude (no duplicate clips).
  const { data: gens } = await admin
    .from("scene_generations")
    .select("metadata")
    .eq("render_job_id", jobId);
  const excludeIds = (gens ?? [])
    .map((g) => (g.metadata as { pexelsId?: number } | null)?.pexelsId)
    .filter((id): id is number => typeof id === "number");

  try {
    const candidates = await searchStockVideoCandidates({
      prompt: scene.prompt,
      hook: scene.caption || undefined,
      topicTitle: job.prompt ?? null,
      excludeIds,
      limit,
      preferPortrait: aspect ? aspect === "9:16" : true,
    });

    // Attach an honest, human "why" derived from the engine's real signals.
    const enriched = candidates.map((c, i) => ({
      ...c,
      reason:
        `${i === 0 ? "Top match" : "Match"} for “${c.query}” · ` +
        `${c.height}p ${c.orientation}${c.durationSec ? ` · ${c.durationSec}s` : ""}`,
    }));

    return NextResponse.json({ sceneId: sceneIdNum, count: enriched.length, candidates: enriched });
  } catch (err) {
    if (err instanceof PexelsNotConfiguredError) {
      return NextResponse.json(
        { error: "Stock search not configured (PEXELS_API_KEY missing)" },
        { status: 503 },
      );
    }
    captureFallback("video.scene.candidates.failed", err, { jobId, sceneId: sceneIdNum, userId });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Candidate search failed" },
      { status: 500 },
    );
  }
}
