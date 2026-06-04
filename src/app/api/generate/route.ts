/**
 * POST /api/generate — Video Pipeline SSE endpoint.
 *
 * Streams Server-Sent Events to the /video/generate page so it can render
 * live stage progression while the pipeline runs. The page already wires
 * to this URL (see src/app/video/generate/page.tsx:171); we're filling in
 * the previously-missing backend.
 *
 * Event vocabulary (matches src/lib/types.ts SSEEvent):
 *   {type:"log", level, message}      drop a log line; client also derives
 *                                      stage from the message text via
 *                                      stageFromLog()
 *   {type:"status", label?, pct?}     overall progress hint
 *   {type:"done", videoUrl, jobId}    pipeline finished — page swaps to
 *                                      <video src=videoUrl autoplay>
 *   {type:"error", error}             surfaces to the failure card
 *
 * Stages (page renders these as a 6-step timeline):
 *   script → storyboard → voice → clips → music → render
 *
 * What's real today (no SDK upgrade required):
 *   - Script:     Gemini Flash (generateVideoScript)
 *   - Storyboard: Gemini Flash JSON (generateVideoStoryboard)
 *   - Hero frame: Imagen 3 single 9:16 image (best-effort; skipped on err)
 *
 * What's stubbed (clearly logged so the user knows):
 *   - Voice: ElevenLabs hook not wired yet
 *   - Clips: per-scene Veo 3 generation needs SDK upgrade (@google/genai v0.3
 *            we have ships generateImages but no generateVideos). Logged as
 *            stub
 *   - Music: Suno-style track selection — stubbed
 *   - Render: returns a stable placeholder MP4 URL so the page's <video>
 *             can play something end-to-end. Swap for the real Veo render
 *             once we upgrade the SDK
 *
 * Both the real and stubbed work get persisted to `render_jobs` so future
 * list views and analytics have something to attach to.
 */
import { type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";
import { captureFallback } from "@/lib/observability";
import { videoMergeQueue } from "@/lib/queue";
import { getBudgetStatus, recordAIUsage, COST } from "@/lib/budget";
// `generateScene` no longer imported here — Phase D moves the provider
// calls to the worker. See worker/processors/video-merge.ts.
import {
  generateVideoScript,
  generateVideoStoryboard,
  generateHeroFrame,
  generateVideoSEO,
  extractImportantWords,
} from "@/lib/gemini";
import {
  synthesizeNarration,
  ElevenLabsNotConfiguredError,
} from "@/lib/elevenlabs";
import {
  findTrackByVibe,
  JamendoNotConfiguredError,
} from "@/lib/jamendo";
import {
  findStockVideoByPrompt,
  PexelsNotConfiguredError,
} from "@/lib/pexels";

export const runtime = "nodejs";
// Vercel hobby plan default is 10s — bump for the multi-call pipeline.
// Each Gemini call has a 90s timeout, so ~3min covers script + storyboard
// + hero frame + buffer.
export const maxDuration = 300;

// Accepts either the legacy free-form prompt OR the new brand+topic shape.
// Validation requires AT LEAST ONE of {prompt, (brandId+topicId)} to be
// present — otherwise the route can't construct a script.
const Schema = z
  .object({
    prompt: z.string().min(8).max(2000).optional(),
    brandId: z.string().uuid().optional(),
    topicId: z.string().uuid().optional(),
    provider: z.enum(["veo3", "higgsfield", "imagen3"]).optional(),
    style: z.string().max(40).optional(),
    sceneCount: z.number().int().min(3).max(8).optional(),
    musicVibe: z.string().max(40).optional(),
    renderVariant: z.string().max(40).optional(),
    hookStyle: z.string().max(40).optional(),
    projectId: z.string().uuid().optional(),
  })
  .refine(
    (v) => !!v.prompt || (!!v.brandId && !!v.topicId),
    {
      message:
        "Provide either a free-form `prompt` OR both `brandId` AND `topicId`.",
    },
  );

const RATE_LIMIT = { limit: 20, windowSeconds: 60 * 60 } as const; // 20/hr
const ROUTE = "POST:/api/generate";

// Last-resort fallback MP4 if Pexels search returns nothing AND
// PEXELS_API_KEY isn't configured. Big Buck Bunny — visibly unrelated, so
// users notice + we can debug. Real flow now always tries Pexels first
// for a topic-relevant stock clip (see Stage 6 below).
//
// test-videos.co.uk serves with CORS open + 200; Google's
// `gtv-videos-bucket` sample URLs all 403 — don't reach for them again.
const PLACEHOLDER_VIDEO_URL =
  "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function sseFrame(payload: Record<string, unknown>): Uint8Array {
  // SSE format: each event is `data: <json>\n\n`. The client splits on
  // newlines and looks for the `data:` prefix.
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Rate limit — separate bucket from content + brand creation.
  const rl = await rateLimit({
    key: `${ROUTE}:${userId}`,
    limit: RATE_LIMIT.limit,
    windowSeconds: RATE_LIMIT.windowSeconds,
  });
  if (!rl.ok) {
    return new Response(
      JSON.stringify({
        error: "Too many video generations. Slow down.",
        retryAfterSeconds: rl.retryAfterSeconds,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(rl.retryAfterSeconds),
        },
      },
    );
  }

  // ─── B1.R1 · Budget check ────────────────────────────────────────────────
  // Hard-cap blocks BEFORE we spend any Gemini tokens or kick the worker.
  // Soft-cap continues but tags the SSE done event so the UI can warn.
  // First-time users get a $5 default monthly cap (env-tunable).
  const budget = await getBudgetStatus(userId);
  if (!budget.allowed) {
    return new Response(
      JSON.stringify({
        error: "Monthly AI budget exceeded",
        usedUsd: budget.monthlyUsedUsd,
        capUsd: budget.monthlyHardCapUsd,
        monthStart: budget.monthlyStart,
        reason: "hard_cap",
      }),
      {
        status: 402, // Payment Required — semantically correct here
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Parse body
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: "Invalid input",
        details: parsed.error.flatten(),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const input = parsed.data;

  // Defaults — page sometimes omits sceneCount/provider on first submit.
  const provider = input.provider ?? "veo3";
  // Phase 1A (VIDEO_VARIATION_AUDIT §P1.6) — when the user doesn't specify
  // a style, rotate across a curated pool instead of always defaulting to
  // "cinematic". Users who DO pass `style` get exactly what they asked for.
  const STYLE_POOL = [
    "cinematic",
    "documentary",
    "handheld ugc",
    "luxury commercial",
    "founder pov",
    "social proof",
  ] as const;
  const style =
    input.style ?? STYLE_POOL[Math.floor(Math.random() * STYLE_POOL.length)];
  const sceneCount = input.sceneCount ?? 4;
  const musicVibe = input.musicVibe ?? "energetic";
  const targetSeconds = Math.max(15, Math.min(60, sceneCount * 6));

  const admin = createAdminClient();

  // ─── Resolve prompt from brand+topic when provided ─────────────────────────
  // The new Phase 2 flow sends { brandId, topicId } instead of a free-form
  // prompt. We look up the topic + brand voice and synthesize a richer
  // prompt that downstream Gemini calls condition on. The legacy `prompt`
  // path stays intact for backwards compat.
  let effectivePrompt: string;
  let brandIdForJob: string | null = null;
  let topicIdForJob: string | null = null;
  // Video Pipeline v2 P1 — hoist structured brand + topic into outer scope so
  // downstream Gemini calls (storyboard) and Pexels fallback can receive them
  // as labeled fields instead of having to re-extract them from effectivePrompt.
  let brandForGen: { name: string; industry: string | null } | null = null;
  let topicForGen: { title: string; category: string | null } | null = null;

  if (input.brandId && input.topicId) {
    const { data: topic, error: topicErr } = await admin
      .from("brand_topics")
      .select("id, brand_id, title, description, category, hook_angle, seed_keyword")
      .eq("id", input.topicId)
      .eq("brand_id", input.brandId)
      .single();

    if (topicErr || !topic) {
      return new Response(
        JSON.stringify({ error: "Topic not found for this brand" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const { data: brand, error: brandErr } = await admin
      .from("brands")
      .select("id, user_id, name, industry, profile")
      .eq("id", input.brandId)
      .single();

    if (brandErr || !brand) {
      return new Response(
        JSON.stringify({ error: "Brand not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    if (brand.user_id !== userId) {
      // 404 to avoid existence leak
      return new Response(
        JSON.stringify({ error: "Topic not found for this brand" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    // Synthesize the prompt from brand + topic. Includes brand voice cues
    // so the script generator stays on-brand.
    const profile = brand.profile as null | {
      brand_voice?: { tone?: string[] };
      positioning_statement?: string;
    };
    const tone = profile?.brand_voice?.tone?.join(", ") ?? "confident, energetic";
    const positioning = profile?.positioning_statement ?? "";

    effectivePrompt = [
      `${topic.title}.`,
      topic.hook_angle ? `Open with: "${topic.hook_angle}"` : "",
      topic.description ?? "",
      `Brand: ${brand.name}${brand.industry ? ` (${brand.industry})` : ""}.`,
      positioning ? `Positioning: ${positioning}.` : "",
      `Voice tone: ${tone}.`,
      `Topic category: ${topic.category ?? "educational"}.`,
    ]
      .filter(Boolean)
      .join(" ");

    brandIdForJob = brand.id as string;
    topicIdForJob = topic.id as string;
    // v2 P1 — capture structured brand + topic for downstream calls.
    brandForGen = {
      name: brand.name as string,
      industry: (brand.industry as string | null) ?? null,
    };
    topicForGen = {
      title: topic.title as string,
      category: (topic.category as string | null) ?? null,
    };
  } else if (input.prompt) {
    effectivePrompt = input.prompt;
  } else {
    // refine() should have caught this — defensive only
    return new Response(
      JSON.stringify({ error: "Missing prompt or brand+topic" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Pre-create render_jobs row with full provenance so /video/history can
  // surface every past generation. Worker writes back to this row as the
  // pipeline progresses.
  const { data: jobRow, error: jobErr } = await admin
    .from("render_jobs")
    .insert({
      project_id: input.projectId ?? null,
      user_id: userId,
      brand_id: brandIdForJob,
      topic_id: topicIdForJob,
      style: style,
      prompt: effectivePrompt.slice(0, 2000),
      name: effectivePrompt.slice(0, 80),
      status: "queued",
      progress: 0,
      template: provider,
    })
    .select("id")
    .single();

  if (jobErr || !jobRow) {
    captureFallback("video.generate.job_insert_failed", jobErr, { provider });
    return new Response(
      JSON.stringify({
        error: jobErr?.message ?? "Failed to create render job",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const jobId = jobRow.id as string;

  // Mark the topic as used (atomic increment via SQL fn so concurrent
  // renders from the same topic don't race). Fire-and-forget — wrap in
  // an async IIFE because Supabase's .rpc() returns a thenable that
  // exposes .then() but not .catch().
  if (topicIdForJob) {
    void (async () => {
      try {
        await admin.rpc(
          "increment_brand_topic_use" as never,
          { p_topic_id: topicIdForJob } as never,
        );
      } catch (e) {
        captureFallback("brand_topic.use_increment_failed", e, {
          topicId: topicIdForJob,
        });
      }
    })();
  }

  // ─── SSE stream ────────────────────────────────────────────────────────────
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (payload: Record<string, unknown>) => {
        try {
          controller.enqueue(sseFrame(payload));
        } catch {
          // Client disconnected; ignore — we'll catch it on the next call too.
        }
      };
      const log = (
        level: "info" | "success" | "error" | "warn",
        message: string,
      ) => emit({ type: "log", level, message });
      const status = (label: string, pct: number) =>
        emit({ type: "status", label, pct });

      const startMs = Date.now();

      try {
        // ─── Stage 1: Script ────────────────────────────────────────────────
        log("info", "Started: Script");
        status("Generating script", 5);
        await admin
          .from("render_jobs")
          .update({ status: "rendering", progress: 5 })
          .eq("id", jobId);

        const script = await generateVideoScript({
          prompt: effectivePrompt,
          style,
          musicVibe,
          targetSeconds,
        });
        // R1: record Gemini call cost. Failure here is non-fatal; the
        // ledger is for billing audit + analytics, not request blocking.
        void recordAIUsage({
          userId,
          renderJobId: jobId,
          provider: "gemini",
          operation: "generateVideoScript",
          costUsd: COST.gemini.perCallUsd,
        });
        log(
          "success",
          `Script ready — ${script.estimatedDurationSec}s, hook: "${script.hook.slice(0, 60)}${script.hook.length > 60 ? "…" : ""}"`,
        );
        status("Script ready", 18);

        // ─── Stage 2: Storyboard ────────────────────────────────────────────
        log("info", "Started: Storyboard");
        status("Building storyboard", 22);

        const storyboard = await generateVideoStoryboard({
          prompt: effectivePrompt,
          style,
          sceneCount,
          script,
          // v2 P1a — structured brand + topic so scene descriptions
          // visibly reflect the brand's industry instead of generic stock
          // aesthetics. Both fall back to undefined for legacy free-form
          // prompts (where no brand record exists).
          brand: brandForGen ?? undefined,
          topic: topicForGen ?? undefined,
        });
        void recordAIUsage({
          userId,
          renderJobId: jobId,
          provider: "gemini",
          operation: "generateVideoStoryboard",
          costUsd: COST.gemini.perCallUsd,
        });
        log(
          "success",
          `Storyboard ready — ${storyboard.scenes.length} scenes, ${storyboard.totalDurationSec}s total`,
        );
        for (const scene of storyboard.scenes.slice(0, 5)) {
          log(
            "info",
            `  Scene ${scene.index} (${scene.durationSec}s, ${scene.shotType}): ${scene.description.slice(0, 90)}${scene.description.length > 90 ? "…" : ""}`,
          );
        }
        status("Storyboard ready", 38);

        // ─── Stage 3: Voice ─────────────────────────────────────────────────
        log("info", "Started: Voice");
        status("Synthesizing narration", 42);

        // Concatenate hook + body + cta for the full narration. Each is
        // already short and natural-sounding from the script generator.
        const fullNarration =
          `${script.hook} ${script.body} ${script.cta}`.trim();
        let voiceAudioDataUrl: string | null = null;
        try {
          const voice = await synthesizeNarration({ text: fullNarration });
          voiceAudioDataUrl = voice.audioDataUrl;
          // R1: record ElevenLabs cost based on actual character count.
          void recordAIUsage({
            userId,
            renderJobId: jobId,
            provider: "elevenlabs",
            operation: "synthesizeNarration",
            // $0.18 / 1k chars for turbo_v2.
            costUsd: Math.round((fullNarration.length / 1000) * 0.18 * 100) / 100,
            units: fullNarration.length,
            unitType: "chars",
          });
          log(
            "success",
            `Voice ready — ${Math.round(voice.byteLength / 1024)}KB MP3 (${voice.voiceId}, model ${voice.modelId}, direction "${script.voiceDirection}")`,
          );
        } catch (err) {
          if (err instanceof ElevenLabsNotConfiguredError) {
            log(
              "warn",
              "Voice skipped: ELEVENLABS_API_KEY not configured (stub direction logged)",
            );
          } else {
            log(
              "warn",
              `Voice failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        status("Voice ready", 50);

        // ─── Stage 4: Clips ─────────────────────────────────────────────────
        log("info", "Started: Clips");
        status("Generating hero frame", 55);

        // Try Imagen 3 for a single hero frame so the user gets a real AI
        // visual as proof. Best-effort: any failure is logged and the
        // pipeline continues.
        let heroFrameDataUrl: string | null = null;
        try {
          heroFrameDataUrl = await generateHeroFrame({
            prompt: effectivePrompt,
            style,
          });
          log(
            "success",
            `Hero frame generated (Imagen 3, 9:16, ${Math.round(heroFrameDataUrl.length / 1024)}KB base64)`,
          );
        } catch (err) {
          // Imagen 3 may not be enabled on the API key; that's OK — log
          // and keep going.
          log(
            "warn",
            `Hero frame skipped: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        log(
          "warn",
          `Per-scene Veo 3 generation — stub: @google/genai v0.3 ships generateImages only, no generateVideos yet`,
        );
        await new Promise((r) => setTimeout(r, 800));
        log("success", `Clips stub complete (${storyboard.scenes.length} scenes simulated)`);
        status("Clips ready", 72);

        // ─── Stage 5: Music ─────────────────────────────────────────────────
        log("info", "Started: Music");
        status("Finding track", 76);

        let musicTrackUrl: string | null = null;
        let musicTrackName: string | null = null;
        try {
          const track = await findTrackByVibe({
            vibe: musicVibe,
            targetSeconds,
          });
          if (track) {
            musicTrackUrl = track.audio;
            musicTrackName = `${track.name} — ${track.artist_name}`;
            log(
              "success",
              `Music ready — "${track.name}" by ${track.artist_name} (${track.duration}s, Jamendo CC)`,
            );
          } else {
            log("warn", `Music skipped: no Jamendo tracks matched vibe "${musicVibe}"`);
          }
        } catch (err) {
          if (err instanceof JamendoNotConfiguredError) {
            log(
              "warn",
              `Music skipped: JAMENDO_CLIENT_ID not configured (vibe was "${musicVibe}")`,
            );
          } else {
            log(
              "warn",
              `Music failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        status("Music ready", 80);

        // ─── Stage 7: SEO copy ──────────────────────────────────────────────
        // Generate upload-ready post copy (title, description, hashtags) so
        // the user can paste it straight into TikTok/IG. Best-effort: any
        // failure logs warn and the pipeline still completes — the rest of
        // the assets are independent.
        log("info", "Started: SEO");
        status("Writing post copy", 84);
        let seo: { title: string; description: string; hashtags: string[] } | null = null;
        try {
          const seoResult = await generateVideoSEO({
            prompt: effectivePrompt,
            script,
          });
          seo = seoResult;
          void recordAIUsage({
            userId,
            renderJobId: jobId,
            provider: "gemini",
            operation: "generateVideoSEO",
            costUsd: COST.gemini.perCallUsd,
          });
          log(
            "success",
            `SEO ready — title "${seoResult.title.slice(0, 50)}${seoResult.title.length > 50 ? "…" : ""}", ${seoResult.hashtags.length} hashtags`,
          );
        } catch (err) {
          log(
            "warn",
            `SEO skipped: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        status("SEO ready", 84);

        // ─── Stage 7b: Keyword overlays ─────────────────────────────────────
        // Pull viral-style keyword overlays out of the narration script so
        // the worker can drop them on-screen via FFmpeg drawtext. Best-effort
        // — if Gemini fails here the video still renders cleanly (no overlays).
        log("info", "Started: Overlays");
        status("Extracting keyword overlays", 86);
        let overlayBundle: {
          keywords: { text: string; start: number; end: number; emphasis?: "normal" | "punch" | "highlight" }[];
          estimatedNarrationSec: number;
        } | null = null;
        try {
          const fullNarrationText =
            `${script.hook} ${script.body} ${script.cta}`.trim();
          const narrationDuration =
            script.estimatedDurationSec ?? targetSeconds;
          const result = await extractImportantWords({
            narration: fullNarrationText,
            estimatedNarrationSec: narrationDuration,
            density: "balanced",
          });
          overlayBundle = result;
          void recordAIUsage({
            userId,
            renderJobId: jobId,
            provider: "gemini",
            operation: "extractImportantWords",
            costUsd: COST.gemini.perCallUsd,
          });
          log(
            "success",
            `Overlays ready — ${result.keywords.length} keywords spanning ${result.estimatedNarrationSec}s`,
          );
        } catch (err) {
          log(
            "warn",
            `Overlays skipped: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        status("Overlays ready", 88);

        // Persist all generated artifacts on render_jobs so /video/history
        // can resurface them without re-running the pipeline.
        await admin
          .from("render_jobs")
          .update({
            script_json: script as unknown as Record<string, unknown>,
            storyboard_json: storyboard as unknown as Record<string, unknown>,
            seo_json: (seo ?? null) as unknown as Record<string, unknown> | null,
            overlay_json: overlayBundle
              ? { keywords: overlayBundle.keywords }
              : null,
          })
          .eq("id", jobId);

        // ─── Stage 6 · Defer scene generation to the worker (audit C1/M2) ─
        //
        // Previously this stage ran registry.generateScene() inline for each
        // storyboard scene. Two problems:
        //   1. Vercel function maxDuration=300s. Runway can take 60s per
        //      scene → 4 scenes serially blow the budget. Concurrency 3
        //      kept us within budget but with zero slack for retries.
        //   2. Memory pressure: scene clips + Gemini responses + narration
        //      data URL all sat in the same Node Function memory.
        //
        // Audit fix: hand the specs to the worker. SSE returns done after
        // the cheap Gemini stages (~30s total). Worker generates scenes
        // via the same registry chain, with zero timeout cap. Page Realtime
        // already subscribes to scene_generations rows for live updates.
        log("info", "Started: Render");
        status("Queueing scene generation", 88);
        await admin
          .from("render_jobs")
          .update({ progress: 88 })
          .eq("id", jobId);

        // Build the scene spec list — the worker will turn each into a
        // scene_generations row + composited clip.
        const sceneSpecs = storyboard.scenes.map((scene) => ({
          index: scene.index,
          prompt: scene.description,
          shotType: scene.shotType,
          durationSec: Math.max(3, Math.min(10, scene.durationSec)),
        }));

        // Pre-fetch a single Pexels clip as a fallback `videoUrl` for the
        // merge payload. Worker uses this if scene generation produces
        // nothing usable (provider chain exhausted on every scene).
        let videoUrl = PLACEHOLDER_VIDEO_URL;
        let videoAttribution: string | null = null;
        try {
          const clip = await findStockVideoByPrompt({
            prompt: effectivePrompt,
            hook: script.hook,
            targetSeconds,
            // v2 P1b — surface brand industry + topic title at HIGHEST
            // priority for query construction (above the 12 hardcoded
            // TOPIC_OVERRIDES regexes, which only cover a fraction of
            // possible industries).
            brandIndustry: brandForGen?.industry ?? null,
            topicTitle: topicForGen?.title ?? null,
          });
          if (clip) {
            videoUrl = clip.url;
            videoAttribution = `${clip.photographer} via Pexels`;
          }
        } catch (err) {
          if (!(err instanceof PexelsNotConfiguredError)) {
            log(
              "warn",
              `Single-clip fallback prefetch failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        log(
          "success",
          `Render queued — ${sceneSpecs.length} scenes will be generated by the worker`,
        );

        const durationMs = Date.now() - startMs;
        await admin
          .from("render_jobs")
          .update({
            status: "done",
            progress: 100,
            output_url: videoUrl,
            completed_at: new Date().toISOString(),
            duration_ms: durationMs,
          })
          .eq("id", jobId);

        status("Complete", 100);
        emit({
          type: "done",
          videoUrl,
          jobId,
          // Extra payload for the page to render audio + music players,
          // Pexels attribution, and upload-ready SEO copy.
          audioUrl: voiceAudioDataUrl ?? undefined,
          musicUrl: musicTrackUrl ?? undefined,
          musicTrack: musicTrackName ?? undefined,
          videoAttribution: videoAttribution ?? undefined,
          seo: seo ?? undefined,
        });

        // ─── Post-pipeline: enqueue ffmpeg merge ─────────────────────────────
        // Kick off a Railway worker job that takes our 3 separate assets
        // (Pexels MP4 + ElevenLabs narration data URL + Jamendo MP3 URL)
        // and produces one downloadable MP4 in Supabase Storage. The page
        // subscribes to render_jobs.merged_video_url via Realtime and swaps
        // the Download button when ready.
        //
        // Fire-and-forget: we don't await this — the SSE stream is already
        // closing. If the enqueue itself throws (Redis down) we capture but
        // don't surface it to the page; the merged-video is a bonus, the
        // unmerged playable assets are already in the user's hands.
        try {
          await admin
            .from("render_jobs")
            .update({
              merge_status: "pending",
              music_url: musicTrackUrl ?? null,
              music_track: musicTrackName ?? null,
              video_attribution: videoAttribution ?? null,
            })
            .eq("id", jobId);
          await videoMergeQueue().add(
            "merge",
            {
              renderJobId: jobId,
              userId,
              videoUrl,
              audioDataUrl: voiceAudioDataUrl ?? undefined,
              musicUrl: musicTrackUrl ?? undefined,
              overlays: overlayBundle
                ? overlayBundle.keywords.map((k) => ({
                    text: k.text,
                    start: k.start,
                    end: k.end,
                  }))
                : undefined,
              // Phase D — hand storyboard specs to the worker. The worker
              // calls registry.generateScene() for each and persists rows.
              sceneSpecs:
                sceneSpecs.length > 1
                  ? sceneSpecs.map((s) => ({
                      index: s.index,
                      prompt: s.prompt,
                      shotType: s.shotType ?? null,
                      durationSec: s.durationSec,
                    }))
                  : undefined,
              // Phase 1A (VIDEO_VARIATION_AUDIT §P1.4) — pass storyboard's
              // aestheticNotes (palette / lighting / pacing) so the worker
              // can prefix each scene prompt with it. Previously generated
              // and stored but never consumed by any downstream stage.
              aestheticNotes: storyboard.aestheticNotes ?? undefined,
            },
            { jobId },
          );
        } catch (err) {
          captureFallback("video.merge.enqueue_failed", err, { jobId });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        captureFallback("video.generate.pipeline_failed", err, {
          jobId,
          provider,
          promptLength: effectivePrompt.length,
        });
        log("error", message);
        emit({ type: "error", error: message });

        await admin
          .from("render_jobs")
          .update({
            status: "failed",
            error_message: message,
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      } finally {
        try {
          controller.close();
        } catch {
          // Stream may already be closed by client disconnect — ignore.
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Hint to Vercel + intermediaries not to buffer the stream
      "X-Accel-Buffering": "no",
    },
  });
}
