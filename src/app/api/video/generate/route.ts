/**
 * POST /api/video/generate — Ottoflow Video V1 (AI-first, Seedance → FFmpeg).
 *
 * Two entry shapes (Sprint 43):
 *   content-anchored — contentItemId: reuses the item's creative brief
 *     (tension/metaphor/palette/logo), unchanged behaviour;
 *   standalone — topic: "start from an idea", no content item / brief needed;
 *     always the commercial_story engine (certified requires a brief).
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
import { buildCommercialStory } from "@/lib/ffmpeg-pipeline/story-agent";
import { isVideoRenderEnabled } from "@/lib/video/flags";
import { estimateRenderCost } from "@/lib/video/cost";
import { getSeedanceBalanceUsd } from "@/lib/video-providers/seedance";
import { buildAiFirstPlan, type AiFirstClip } from "@/lib/ffmpeg-pipeline/orchestrator";
import { resolveVisualWorld } from "@/lib/brand/visual-world";
import { getPlatformProfile } from "@/lib/platform/profiles";
import { pickCta } from "@/lib/platform/platform-cta";
import type { AgentContext, SourceName, VideoStrategy } from "@/lib/ffmpeg-pipeline/types";

export const runtime = "nodejs";
export const maxDuration = 120; // buildVideoStrategy is one Gemini call.

/** Sprint 4 — the customer-facing "Rendering Mode" presets map onto the TWO real
 * engines (no architecture fork): the certified abstract 4-beat path and the
 * human-first commercial_story 6-beat path. Default → certified (keeps render
 * 46bd40cd / b1807d29 reproducible when nothing is selected). */
const UI_MODE_TO_ENGINE: Record<string, "certified" | "commercial_story"> = {
  certified: "certified",
  ai_storytelling: "certified",
  commercial_story: "commercial_story",
  product_demo: "commercial_story",
  explainer: "commercial_story",
  founder_video: "commercial_story",
  social_ad: "commercial_story",
};

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
  /** Sprint 43 — now optional: the content-item anchor. Absent → standalone
   * "start from an idea" (a freeform `topic` drives the video; no creative
   * brief needed). Exactly one of contentItemId/topic is required (refine below). */
  contentItemId: z.string().uuid().optional(),
  /** Sprint 43 — standalone topic. Only read when contentItemId is absent
   * (content-anchored keeps deriving the topic from the item title, unchanged).
   * Standalone always runs the commercial_story engine — the certified 4-beat
   * engine requires a brief's visual_tension/visual_metaphor, which don't exist
   * without a content item. */
  topic: z.string().min(8).max(200).optional(),
  /** Sprint 4 — destination platform (source of truth for aspect/duration
   * defaults). All 9 Platform Agent platforms. Default "linkedin" preserves the
   * legacy caller. */
  platform: z
    .enum([
      "tiktok",
      "instagram_reels",
      "instagram_feed",
      "youtube_shorts",
      "youtube_standard",
      "facebook_reels",
      "facebook_feed",
      "linkedin",
      "x",
    ])
    .default("linkedin"),
  /** Output aspect (Video V1.1 — Platform Agent). Optional; absent → derived from
   * the platform profile. The certified 1080×1920 path is platform=linkedin +
   * aspect="9:16". */
  aspect: z.enum(["9:16", "16:9", "1:1"]).optional(),
  /** Sprint 4 — scene-generation resolution. Cost-bearing (1080p ≈ 1.5×). The
   * compose canvas is already 1080p-class per aspect; this governs source-clip
   * fidelity + the estimate. Default "720p" = the certified tier. */
  resolution: z.enum(["720p", "1080p"]).optional().default("720p"),
  /** Sprint 4 — quality preset (maps internally). "best" implies 1080p when no
   * explicit resolution is given. */
  quality: z.enum(["fast", "balanced", "best"]).optional().default("balanced"),
  /** Sprint 4 — total target video length (s). Absent ("Auto") → certified keeps
   * its proven 20s; other engines use the platform profile target. */
  durationSec: z.number().int().min(8).max(90).optional(),
  /** Sprint 15 — visual source. Absent/"ai" → unchanged AI-first pipeline.
   * "pexels" → Royalty-Free Library (footage-only, no AI scene generation, no AI cost). */
  source: z.enum(["ai", "pexels"]).optional().default("ai"),
  /** Generation mode (Video V1.1 + Sprint 4 presets). Absent → "certified" = the
   * unchanged 4-beat path that keeps render 46bd40cd reproducible. The 6 UI
   * presets map to the 2 real engines via UI_MODE_TO_ENGINE. */
  mode: z
    .enum([
      "certified",
      "commercial_story",
      "ai_storytelling",
      "product_demo",
      "explainer",
      "founder_video",
      "social_ad",
    ])
    .optional()
    .default("certified"),
  /** Dry run: build strategy + plan + cost estimate, make NO provider calls and
   * enqueue NOTHING. For wiring validation without spend. */
  dryRun: z.boolean().optional().default(false),
  /** Explicit cost approval. Without it (and not a dry run) the route returns a
   * cost estimate and enqueues NOTHING (requiresApproval). */
  approve: z.boolean().optional().default(false),
  /** Optional: reuse a dryRun's strategy on approve (prevents preview/cost drift). */
  strategy: StrategySchema.optional(),
}).refine((v) => !!v.contentItemId || !!v.topic, {
  message: "Provide either contentItemId (content-anchored) or topic (standalone).",
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

  // ─── Platform Agent is the source of truth (Sprint 4) ────────────────────
  const profile = getPlatformProfile(parsed.data.platform);
  // Aspect: explicit override wins, else the platform's profile default.
  const aspect = parsed.data.aspect ?? profile.video.aspect;
  // Sprint 43 — standalone "start from an idea": no content item → no creative
  // brief. The certified 4-beat engine REQUIRES the brief's tension/metaphor,
  // so standalone always runs the commercial_story engine (topic-driven; its
  // visualTension input is optional subtext).
  const standalone = !parsed.data.contentItemId;
  // Rendering mode preset → one of the 2 real engines (no fork).
  const mode = standalone
    ? "commercial_story"
    : UI_MODE_TO_ENGINE[parsed.data.mode] ?? "certified";
  // Resolution: HARDENING (Sprint 4.1) — taken ONLY from the explicit selector,
  // never silently overridden by quality (that desynced the UI). 1080p is not
  // yet wired end-to-end (worker renders 720p source regardless) and the UI
  // disables it, so this is effectively 720p today; the field is forwarded for
  // the future wiring point.
  const resolution: "720p" | "1080p" = parsed.data.resolution === "1080p" ? "1080p" : "720p";
  const quality = parsed.data.quality;
  // Sprint 15 — visual source. "pexels" = Royalty-Free Library (footage-only, no AI cost).
  const source: "ai" | "pexels" = parsed.data.source === "pexels" ? "pexels" : "ai";
  // Duration ("Auto" = omitted): certified keeps its proven 20s; other engines
  // use the platform profile's target window (upper bound, clamped to ≤90s).
  const [profLo, profHi] = profile.video.targetDurationSec;
  const totalDurationSec =
    parsed.data.durationSec ?? (mode === "certified" ? 20 : Math.min(profHi, 60));

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
  // Content-anchored only. Standalone has no brief: brief stays null, the topic
  // comes straight from the request, and commercial_story treats the missing
  // tension as absent subtext (supported input).
  let brief: CreativeBriefLite | null = null;
  let topic = parsed.data.topic?.trim().slice(0, 200) || "Brand video";
  if (contentItemId) {
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
    const b = creative.creative_brief as CreativeBriefLite;
    if (!b.visual_tension || !b.visual_metaphor) {
      return Response.json(
        { error: "Creative brief is missing visual_tension/visual_metaphor." },
        { status: 400 },
      );
    }
    brief = b;

    const { data: item } = await admin
      .from("content_items")
      .select("title")
      .eq("id", contentItemId)
      .maybeSingle();
    topic = (item?.title as string | undefined)?.slice(0, 200) ?? "Brand video";
  }

  // ─── Visual World V1 (Brand Finish Layer) ────────────────────────────────
  // The brand's persistent "how it looks": source of grade, logo, CTA, caption
  // typography, seed family, style preamble + negative prompt. Falls back to a
  // deterministic derivation from the brief's palette/logo/CTA when the brand
  // has no stored world → behaviour identical to the pre-V1 brief-derived path.
  const world = resolveVisualWorld((brand as { visual_world?: unknown }).visual_world, {
    palette: brief?.palette ?? null,
    brandName: (brand.name as string | null) ?? null,
    logoAssetId: brief?.logo_usage?.use ? brief.logo_usage.asset_id ?? null : null,
    ctaText: brief?.cta ?? null,
  });
  // Sprint 6 — platform-aware CTA for the commercial_story end card (mode-gated;
  // certified keeps the brief/world CTA verbatim → byte-identical). Standalone
  // seeds the deterministic pick from the topic instead of the content id.
  const platformCta =
    mode === "commercial_story" ? pickCta(parsed.data.platform, contentItemId ?? topic) : null;
  const endcardCta = world.endcard.enabled ? platformCta ?? world.endcard.ctaText : null;
  const branding = {
    brandId,
    brandName: (brand.name as string | null) ?? null,
    logoAssetId: world.logo.assetId,
    ctaText: endcardCta,
    palette: brief?.palette ?? null,
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
        ? (() => {
            const s = { ...(passedStrategy as unknown as VideoStrategy) };
            // Re-pin from the server-side brief when one exists (content-anchored);
            // standalone has no brief — the previewed strategy's own fields stand.
            if (brief?.visual_tension) s.visual_tension = brief.visual_tension;
            if (brief?.visual_metaphor) s.visual_metaphor = brief.visual_metaphor;
            return s;
          })()
        : mode === "commercial_story"
          ? await buildCommercialStory({
              topic,
              visualTension: brief?.visual_tension ?? null,
              brandIndustry: (brand.industry as string | null) ?? null,
              brandName: (brand.name as string | null) ?? null,
              palette: brief?.palette ?? null,
              targetDurationSec: [Math.max(profLo, Math.round(totalDurationSec * 0.7)), totalDurationSec],
              platform: parsed.data.platform,
            })
          : await buildVideoStrategy({
              topic,
              // Certified engine — only reachable content-anchored (standalone is
              // forced onto commercial_story above), so the brief fields exist;
              // the ?? "" fallbacks are for the type system only.
              visualTension: brief?.visual_tension ?? "",
              visualMetaphor: brief?.visual_metaphor ?? "",
              brandIndustry: (brand.industry as string | null) ?? null,
              palette: brief?.palette ?? null,
              totalDurationSec,
            });

    // ─── Cost estimate (computed BEFORE any spend) ────────────────────────────
    // Royalty-Free Library has NO AI generation cost (Pexels footage is free).
    const estimate = estimateRenderCost(strategy, { resolution, source });

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
        render_kind: source === "pexels" ? "stock-first" : "ai-first",
        scene_provider: source === "pexels" ? "pexels" : "seedance",
        merge_status: "pending",
        prompt: topic,
        video_strategy: strategy as unknown as Record<string, unknown>,
        // Sprint 39.2 — persist the COMPLETE render context so one scene can be
        // re-generated later (Replace Visual) with the same settings. Mirrors the
        // scene-gen enqueue payload below (minus renderJobId/userId/strategy, which
        // are recoverable). Provider-agnostic. Requires migration 031.
        render_context: {
          topic,
          brandId,
          brandIndustry: (brand.industry as string | null) ?? null,
          aspectRatio: aspect,
          mode,
          platform: parsed.data.platform,
          resolution,
          quality,
          source,
          branding,
        } as unknown as Record<string, unknown>,
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
        mode,
        platform: parsed.data.platform,
        resolution,
        quality,
        source,
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
