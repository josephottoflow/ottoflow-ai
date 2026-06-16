/**
 * POST /api/video/generate — Ottoflow Video V1 (AI-first, Seedance → FFmpeg).
 *
 * Turns an existing content item's creative brief into a brand-aligned video:
 *   read brief (visual_tension/visual_metaphor/cta/palette/logo) →
 *   buildVideoStrategy (4-beat arc, reuses the SAME tension/metaphor as the
 *   still creative — no second creative engine) →
 *   create render_jobs (render_kind='ai-first') →
 *   enqueue `scene-generation` (worker generates clips + FFmpeg-composes).
 *
 * This route performs NO live video-provider/render execution. The actual
 * Seedance generation + FFmpeg compose run in the worker and only fire when
 * SEEDANCE_API_KEY (+ the Railway RAM bump) are provisioned — live validation
 * is deferred. The route just enqueues.
 *
 * LinkedIn first (9:16). Auth via Clerk; the caller must own the brand.
 */
import { type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";
import { captureFallback } from "@/lib/observability";
import { sceneGenerationQueue } from "@/lib/queue";
import { buildVideoStrategy } from "@/lib/ffmpeg-pipeline/video-strategy";

export const runtime = "nodejs";
export const maxDuration = 120; // buildVideoStrategy is one Gemini call.

const Schema = z.object({
  brandId: z.string().uuid(),
  contentItemId: z.string().uuid(),
  platform: z.enum(["linkedin"]).default("linkedin"),
});

const RATE_LIMIT = { limit: 20, windowSeconds: 60 * 60 } as const; // 20/hr
const ROUTE = "POST:/api/video/generate";

interface CreativeBriefLite {
  visual_tension?: string;
  visual_metaphor?: string;
  cta?: string;
  palette?: {
    primary?: string | null;
    secondary?: string | null;
    accent?: string | null;
  } | null;
  logo_usage?: { use?: boolean; asset_id?: string | null } | null;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await rateLimit({
    key: `${ROUTE}:${userId}`,
    limit: RATE_LIMIT.limit,
    windowSeconds: RATE_LIMIT.windowSeconds,
  });
  if (!rl.ok) {
    return Response.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ") },
      { status: 400 },
    );
  }
  const { brandId, contentItemId } = parsed.data;

  const admin = createAdminClient();

  // ─── Ownership: the brand must belong to the caller ──────────────────────
  const { data: brand } = await admin
    .from("brands")
    .select("id, name, industry, user_id")
    .eq("id", brandId)
    .maybeSingle();
  if (!brand) return Response.json({ error: "Brand not found" }, { status: 404 });
  if ((brand.user_id as string | null) && brand.user_id !== userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // ─── Reuse the existing creative brief (tension/metaphor/cta/palette/logo) ─
  const { data: creative } = await admin
    .from("content_creatives")
    .select("creative_brief, created_at")
    .eq("content_item_id", contentItemId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!creative?.creative_brief) {
    return Response.json(
      { error: "No creative brief for this content item — generate the post creative first." },
      { status: 400 },
    );
  }
  const brief = creative.creative_brief as CreativeBriefLite;
  if (!brief.visual_tension || !brief.visual_metaphor) {
    return Response.json(
      { error: "Creative brief is missing visual_tension/visual_metaphor." },
      { status: 400 },
    );
  }

  const { data: item } = await admin
    .from("content_items")
    .select("title")
    .eq("id", contentItemId)
    .maybeSingle();
  const topic = (item?.title as string | undefined)?.slice(0, 200) ?? "Brand video";

  try {
    // ─── Video Strategy (reuses tension/metaphor — no second creative engine) ─
    const strategy = await buildVideoStrategy({
      topic,
      visualTension: brief.visual_tension,
      visualMetaphor: brief.visual_metaphor,
      brandIndustry: (brand.industry as string | null) ?? null,
      palette: brief.palette ?? null,
      totalDurationSec: 20,
    });

    // ─── render_jobs row ──────────────────────────────────────────────────────
    const { data: job, error: jobErr } = await admin
      .from("render_jobs")
      .insert({
        name: topic.slice(0, 120),
        status: "queued",
        progress: 0,
        template: "ffmpeg-v2",
        user_id: userId,
        brand_id: brandId,
        render_kind: "ai-first",
        scene_provider: "seedance",
        merge_status: "pending",
        prompt: topic,
        video_strategy: strategy as unknown as Record<string, unknown>,
      })
      .select("id")
      .single();
    if (jobErr || !job) {
      throw new Error(`render_jobs insert failed: ${jobErr?.message ?? "no row"}`);
    }

    // ─── Enqueue scene-generation (worker does the provider + FFmpeg work) ────
    await sceneGenerationQueue().add("scene-gen", {
      renderJobId: job.id as string,
      userId,
      topic,
      brandId,
      brandIndustry: (brand.industry as string | null) ?? null,
      strategy,
      branding: {
        brandId,
        brandName: (brand.name as string | null) ?? null,
        logoAssetId: brief.logo_usage?.use ? brief.logo_usage.asset_id ?? null : null,
        ctaText: brief.cta ?? null,
        palette: brief.palette ?? null,
      },
    });

    return Response.json({ renderJobId: job.id, status: "queued" }, { status: 202 });
  } catch (err) {
    captureFallback("video.generate.failed", err, { brandId, contentItemId, userId });
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
