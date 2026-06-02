/**
 * Luma Dream Machine provider — real text-to-video REST integration.
 *
 * Activates the moment `LUMA_API_KEY` lands in env. Until then,
 * isConfigured() returns false and the registry skips this provider.
 *
 * API shape (verified against docs.lumalabs.ai, 2026-06-03):
 *   POST https://api.lumalabs.ai/dream-machine/v1/generations/video
 *     Headers: Authorization: Bearer <key>
 *     Body:    { model, prompt, aspect_ratio, duration, resolution }
 *   Polling: GET https://api.lumalabs.ai/dream-machine/v1/generations/{id}
 *     state: "queued" | "dreaming" | "completed" | "failed"
 *     completed → assets.video is the MP4 URL
 *
 * Pricing (approx, Ray Flash 2): ~$0.14 per 5s clip at 720p. Cheaper than
 * Runway Gen-4. Quality is slightly behind Runway for cinematic shots but
 * great for stock-replacement at our price point.
 */
import type { SceneRequest, SceneResult, VideoProvider } from "./types";

const LUMA_BASE = "https://api.lumalabs.ai/dream-machine/v1";
const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 240_000;

type LumaState = "queued" | "dreaming" | "completed" | "failed";

interface LumaCreateResp {
  id: string;
  state: LumaState;
  failure_reason: string | null;
  assets?: { video?: string };
}

interface LumaPollResp extends LumaCreateResp {}

/** Map 9:16 / 16:9 / 1:1 → Luma's aspect_ratio enum. */
function lumaAspect(aspect: "9:16" | "16:9" | "1:1" | undefined): string {
  switch (aspect) {
    case "16:9":
      return "16:9";
    case "1:1":
      return "1:1";
    case "9:16":
    default:
      return "9:16";
  }
}

/** Round target duration to Luma's supported values: "5s" or "9s". */
function lumaDuration(target: number): "5s" | "9s" {
  return target >= 7 ? "9s" : "5s";
}

export class LumaProvider implements VideoProvider {
  name = "luma";

  isConfigured(): boolean {
    return !!process.env.LUMA_API_KEY;
  }

  async generateScene(request: SceneRequest): Promise<SceneResult> {
    const apiKey = process.env.LUMA_API_KEY;
    if (!apiKey) throw new Error("LUMA_API_KEY not configured");

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const startMs = Date.now();

    // ─── 1. Create generation ────────────────────────────────────────────────
    const createBody = {
      // ray-flash-2 is the cheapest + fastest Luma model. Use ray-2 for
      // premium quality if cost isn't the constraint.
      model: "ray-flash-2",
      prompt: request.prompt,
      aspect_ratio: lumaAspect(request.aspectRatio),
      duration: lumaDuration(request.durationSec),
      resolution: "720p",
    };

    const createRes = await fetch(`${LUMA_BASE}/generations/video`, {
      method: "POST",
      headers,
      body: JSON.stringify(createBody),
    });

    if (!createRes.ok) {
      const body = await createRes.text().catch(() => "");
      throw new Error(
        `Luma create ${createRes.status}: ${body.slice(0, 300) || createRes.statusText}`,
      );
    }
    const created = (await createRes.json()) as LumaCreateResp;
    if (!created.id) {
      throw new Error("Luma create response had no id");
    }

    // ─── 2. Poll until completed or failed ──────────────────────────────────
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const pollRes = await fetch(
        `${LUMA_BASE}/generations/${created.id}`,
        { headers },
      );
      if (!pollRes.ok) {
        // Transient — Luma occasionally returns 502 mid-generation. Retry.
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      const polled = (await pollRes.json()) as LumaPollResp;
      if (polled.state === "completed") {
        const videoUrl = polled.assets?.video;
        if (!videoUrl) {
          throw new Error("Luma completed but assets.video missing");
        }
        const durationMs = Date.now() - startMs;
        return {
          url: videoUrl,
          // Luma rounds to "5s" or "9s" — round-trip back for the caller.
          durationSec: createBody.duration === "9s" ? 9 : 5,
          // 9:16 720p = 720x1280; 16:9 720p = 1280x720; 1:1 720p = 720x720.
          width: createBody.aspect_ratio === "16:9" ? 1280 : 720,
          height:
            createBody.aspect_ratio === "16:9"
              ? 720
              : createBody.aspect_ratio === "1:1"
                ? 720
                : 1280,
          provider: this.name,
          costUsd: 0.14, // approx for ray-flash-2 5s at 720p
          metadata: {
            generationId: created.id,
            generationTimeMs: durationMs,
            model: "ray-flash-2",
          },
        };
      }
      if (polled.state === "failed") {
        throw new Error(
          `Luma generation failed: ${polled.failure_reason ?? "unknown"}`,
        );
      }
      // queued / dreaming → wait + poll again
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    throw new Error(`Luma generation timed out after ${POLL_TIMEOUT_MS}ms`);
  }
}
