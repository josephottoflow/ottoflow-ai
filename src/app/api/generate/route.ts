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
import {
  generateVideoScript,
  generateVideoStoryboard,
  generateHeroFrame,
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

const Schema = z.object({
  prompt: z.string().min(8).max(2000),
  provider: z.enum(["veo3", "higgsfield", "imagen3"]).optional(),
  style: z.string().max(40).optional(),
  sceneCount: z.number().int().min(3).max(8).optional(),
  musicVibe: z.string().max(40).optional(),
  renderVariant: z.string().max(40).optional(),
  hookStyle: z.string().max(40).optional(),
  projectId: z.string().uuid().optional(),
});

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
  const style = input.style ?? "cinematic";
  const sceneCount = input.sceneCount ?? 4;
  const musicVibe = input.musicVibe ?? "energetic";
  const targetSeconds = Math.max(15, Math.min(60, sceneCount * 6));

  // Pre-create render_jobs row so we have a stable jobId to thread back
  // through SSE. Worker writes to this row as the pipeline progresses.
  const admin = createAdminClient();
  const { data: jobRow, error: jobErr } = await admin
    .from("render_jobs")
    .insert({
      project_id: input.projectId ?? null,
      name: input.prompt.slice(0, 80),
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
          prompt: input.prompt,
          style,
          musicVibe,
          targetSeconds,
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
          prompt: input.prompt,
          style,
          sceneCount,
          script,
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
            prompt: input.prompt,
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
        status("Music ready", 84);

        // ─── Stage 6: Render ────────────────────────────────────────────────
        log("info", "Started: Render");
        status("Rendering", 90);
        await admin
          .from("render_jobs")
          .update({ progress: 90 })
          .eq("id", jobId);

        // Pexels stock-video search keyed off the prompt + script hook —
        // returns a topic-relevant MP4 so the final video actually matches
        // what the user asked for (vs. a generic placeholder). This is the
        // production path until Veo lands in @google/genai.
        let videoUrl = PLACEHOLDER_VIDEO_URL;
        let videoAttribution: string | null = null;
        try {
          const clip = await findStockVideoByPrompt({
            prompt: input.prompt,
            hook: script.hook,
            targetSeconds,
          });
          if (clip) {
            videoUrl = clip.url;
            videoAttribution = `${clip.photographer} via Pexels`;
            log(
              "success",
              `Stock clip matched — query "${clip.query}" (${clip.orientation}, ${clip.width}×${clip.height}, ${clip.durationSec}s) by ${clip.photographer}`,
            );
          } else {
            log(
              "warn",
              `No Pexels match for prompt keywords — falling back to placeholder`,
            );
          }
        } catch (err) {
          if (err instanceof PexelsNotConfiguredError) {
            log(
              "warn",
              `Stock clip skipped: PEXELS_API_KEY not configured — falling back to placeholder`,
            );
          } else {
            log(
              "warn",
              `Stock clip failed: ${err instanceof Error ? err.message : String(err)} — falling back to placeholder`,
            );
          }
        }
        log("success", "Render complete");

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
          // Extra payload for the page to render audio + music players
          // + a Pexels attribution line under the video.
          audioUrl: voiceAudioDataUrl ?? undefined,
          musicUrl: musicTrackUrl ?? undefined,
          musicTrack: musicTrackName ?? undefined,
          videoAttribution: videoAttribution ?? undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        captureFallback("video.generate.pipeline_failed", err, {
          jobId,
          provider,
          promptLength: input.prompt.length,
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
