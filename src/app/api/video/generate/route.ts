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
import { isVideoRenderEnabled } from "@/lib/video/flags";
import { estimateRenderCost } from "@/lib/video/cost";
import { getSeedanceBalanceUsd } from "@/lib/video-providers/seedance";
import { buildAiFirstPlan, type AiFirstClip } from "@/lib/ffmpeg-pipeline/orchestrator";
import { resolveVisualWorld } from "@/lib/brand/visual-world";
import type { AgentContext, SourceName, VideoStrategy } from "@/lib/ffmpeg-pipeline/types";

export const runtime = "nodejs";
export const maxDuration = 120; // buildVideoStrategy is one Gemini call.

/** The strategy a prior dryRun returned, re-submitted on approve so the render
 * matches the previewed cost/strategy exactly (no second generation = no drift). */
const StrategySchema = z.object({
  video_concept: z.string(),
  visual_tension: z.string(),
  visual_metaphor: z.string(),
  brand_worldview: z.string(),
  scenes: z
    .array(
      z.object({
        role: z.string(),
        sceneId: z.number(),
        prompt: z.string(),
        caption: z.string().optional().default(""),
        seed: z.number().optional(),
        durationSec: z.number(),
      }),
    )
    .min(1),
});

const Schema = z.object({
  brandId: z.string().uuid(),
  contentItemId: z.string().uuid(),
  platform: z.enum(["linkedin"]).default("linkedin"),
  /** Output aspect (Video V1.1 — Platform Agent). Optional; absent → "9:16" =
   * the certified 1080×1920 path. The platform-first UI sets this from the
   * selected platform's Platform Agent profile; the legacy button omits it so
   * existing renders stay 9:16 (no cert regression). */
  aspect: z.enum(["9:16", "16:9", "1:1"]).optional(),
  /** Dry run: build strategy + plan + cost estimate, make NO provider calls and
   * enqueue NOTHING. For wiring validation without spend. */
  dryRun: z.boolean().optional().default(false),
  /** Explicit cost approval. Without it (and not a dry run) the route returns a
   * cost estimate and enqueues NOTHING (requiresApproval). */
  approve: z.boolean().optional().default(false),
  /** Optional: reuse a dryRun's strategy on approve (prevents preview/cost drift). */
  strategy: StrategySchema.optional(),
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
  // Feature flag (fail-closed): the AI-render path is dark unless explicitly
  // enabled. 404 (not 403) so the route is invisible when off.
  if (!isVideoRenderEnabled()) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

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
  const { brandId, contentItemId, dryRun, approve, strategy: passedStrategy } = parsed.data;
  const aspect = parsed.data.aspect ?? "9:16";

  const admin = createAdminClient();

  // ─── Ownership: the brand must belong to the caller ──────────────────────
  const { data: brand } = await admin
    .from("brands")
    .select("id, name, industry, user_id, visual_world")
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

  // ─── Visual World V1 (Brand Finish Layer) ────────────────────────────────
  // The brand's persistent "how it looks": source of grade, logo, CTA, caption
  // typography, seed family, style preamble + negative prompt. Falls back to a
  // deterministic derivation from the brief's palette/logo/CTA when the brand
  // has no stored world → behaviour identical to the pre-V1 brief-derived path.
  const world = resolveVisualWorld((brand as { visual_world?: unknown }).visual_world, {
    palette: brief.palette ?? null,
    brandName: (brand.name as string | null) ?? null,
    logoAssetId: brief.logo_usage?.use ? brief.logo_usage.asset_id ?? null : null,
    ctaText: brief.cta ?? null,
  });
  const branding = {
    brandId,
    brandName: (brand.name as string | null) ?? null,
    logoAssetId: world.logo.assetId,
    ctaText: world.endcard.enabled ? world.endcard.ctaText : null,
    palette: brief.palette ?? null,
    grade: {
      contrast: world.grade.contrast,
      saturation: world.grade.saturation,
      brightness: world.grade.brightness,
    },
    typography: world.typography,
    stylePreamble: world.stylePreamble,
    negativePrompt: world.negativePrompt,
    seedFamily: world.seedFamily,
  };

  try {
    // ─── Video Strategy (reuses tension/metaphor — no second creative engine) ─
    // One Gemini call. No Seedance/provider call, no render — safe pre-spend.
    // Reuse the dryRun strategy on approve so the render matches the previewed
    // cost/strategy (no second Gemini generation → no drift). Re-pin
    // tension/metaphor from the server-side brief so a client-supplied strategy
    // can't override the authoritative creative fields. dryRun always generates.
    const strategy: VideoStrategy =
      approve && passedStrategy
        ? {
            ...(passedStrategy as unknown as VideoStrategy),
            visual_tension: brief.visual_tension,
            visual_metaphor: brief.visual_metaphor,
          }
        : await buildVideoStrategy({
            topic,
            visualTension: brief.visual_tension,
            visualMetaphor: brief.visual_metaphor,
            brandIndustry: (brand.industry as string | null) ?? null,
            palette: brief.palette ?? null,
            totalDurationSec: 20,
          });

    // ─── Cost estimate (computed BEFORE any spend) ────────────────────────────
    const estimate = estimateRenderCost(strategy);

    // ─── Dry run: build strategy + scene plan + composition plan, NO spend ────
    // Synthesizes placeholder clips so buildAiFirstPlan produces an inspectable
    // CompositionPlan. Makes ZERO provider calls, writes NO render_jobs row, and
    // enqueues NOTHING.
    if (dryRun) {
      const dryCtx: AgentContext = {
        renderJobId: "dry-run",
        userId,
        topic,
        brandId,
        brandIndustry: (brand.industry as string | null) ?? null,
        includeAiScenes: true,
        budgetMode: "standard",
        log: () => {},
      };
      const dryClips: AiFirstClip[] = strategy.scenes.map((s) => ({
        sceneId: s.sceneId,
        url: `dryrun://scene-${s.sceneId}`,
        durationSec: s.durationSec,
        width: 720,
        height: 1280,
        provider: "seedance" as SourceName,
        sourceId: `dryrun-${s.sceneId}`,
      }));
      const compositionPlan = buildAiFirstPlan({
        ctx: dryCtx,
        strategy,
        clips: dryClips,
        branding,
        aspect,
      });
      return Response.json(
        {
          mode: "dry-run",
          strategy,
          scenePlan: strategy.scenes,
          compositionPlan,
          estimate,
          note: "Dry run: no provider calls, no render_jobs row, nothing enqueued.",
        },
        { status: 200 },
      );
    }

    // ─── Cost approval gate: no explicit approval → estimate only, NO enqueue ──
    if (!approve) {
      return Response.json(
        {
          mode: "estimate",
          requiresApproval: true,
          estimate,
          note: "Re-POST with { approve: true } to authorize this spend and enqueue the render.",
        },
        { status: 200 },
      );
    }

    // ─── Atlas balance preflight (Sprint 1A) ─────────────────────────────────
    // Block a render the funded account can't cover, instead of starting it and
    // having scenes fall through to Pexels on a 402 mid-run. FAIL-OPEN: a null
    // balance (key not present on this surface, or AtlasCloud unreachable) means
    // we proceed exactly as before — this only ADDS a guard, never breaks a
    // valid render. No schema/queue/workflow change; one pre-enqueue read.
    const balanceUsd = await getSeedanceBalanceUsd();
    if (balanceUsd !== null && balanceUsd < estimate.estimatedCostUsd) {
      captureFallback(
        "video.generate.insufficient_balance",
        new Error(`balance ${balanceUsd} < estimate ${estimate.estimatedCostUsd}`),
        { brandId, contentItemId, userId, balanceUsd, estimate: estimate.estimatedCostUsd },
      );
      return Response.json(
        {
          error:
            `Insufficient AtlasCloud balance: $${balanceUsd.toFixed(2)} available, ` +
            `~$${estimate.estimatedCostUsd.toFixed(2)} needed for this render. Top up before generating.`,
          balanceUsd,
          estimate,
        },
        { status: 402 },
      );
    }

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
    // attempts:1 — retry-spend protection. A BullMQ retry would re-run the whole
    // scene loop; the worker's resume support skips already-stored scenes, but we
    // also disable auto-retry so a transient failure never silently re-charges.
    await sceneGenerationQueue().add(
      "scene-gen",
      {
        renderJobId: job.id as string,
        userId,
        topic,
        brandId,
        brandIndustry: (brand.industry as string | null) ?? null,
        aspectRatio: aspect,
        strategy,
        branding,
      },
      { attempts: 1, jobId: job.id as string },
    );

    return Response.json(
      { renderJobId: job.id, status: "queued", estimate },
      { status: 202 },
    );
  } catch (err) {
    captureFallback("video.generate.failed", err, { brandId, contentItemId, userId });
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
