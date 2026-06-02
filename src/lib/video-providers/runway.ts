/**
 * Runway Gen-3 Alpha Turbo provider — text-to-video via Runway's REST API.
 *
 * Status: SCAFFOLDED. The actual API call is gated on RUNWAY_API_KEY being
 * set; until then `isConfigured()` returns false and the registry skips
 * straight to Pexels fallback.
 *
 * Once key is provisioned, replace the throw in generateScene() with:
 *   POST https://api.runwayml.com/v1/image_to_video (or text_to_video)
 *   Headers: { Authorization: `Bearer ${RUNWAY_API_KEY}`, X-Runway-Version }
 *   Body: { promptText, model, ratio, duration }
 *   Then poll GET /v1/tasks/{id} until status = SUCCEEDED
 *
 * Pricing (training-era estimate): ~$0.05/sec → $0.25 per 5s clip.
 * 6 scenes × 5s = $1.50/video.
 */
import type { SceneRequest, SceneResult, VideoProvider } from "./types";

export class RunwayProvider implements VideoProvider {
  name = "runway";

  isConfigured(): boolean {
    return !!process.env.RUNWAY_API_KEY;
  }

  async generateScene(_request: SceneRequest): Promise<SceneResult> {
    if (!this.isConfigured()) {
      throw new Error("RUNWAY_API_KEY not configured");
    }
    // TODO(phase-5): wire real Runway Gen-3 Alpha Turbo call.
    //
    // Implementation outline:
    //   const taskRes = await fetch("https://api.runwayml.com/v1/tasks", {
    //     method: "POST",
    //     headers: {
    //       Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`,
    //       "X-Runway-Version": "2024-09-01",
    //       "Content-Type": "application/json",
    //     },
    //     body: JSON.stringify({
    //       model: "gen3a_turbo",
    //       promptText: request.prompt,
    //       ratio: request.aspectRatio ?? "9:16",
    //       duration: Math.min(10, Math.max(5, request.durationSec)),
    //     }),
    //   });
    //   const { id } = await taskRes.json();
    //   const final = await pollTask(id, { timeoutMs: 240_000 });
    //   return {
    //     url: final.output[0],
    //     durationSec: final.duration,
    //     width: 720,
    //     height: 1280,
    //     provider: "runway",
    //     costUsd: 0.05 * final.duration,
    //   };
    throw new Error("RunwayProvider not yet implemented — pending PR after RUNWAY_API_KEY provisioned");
  }
}
