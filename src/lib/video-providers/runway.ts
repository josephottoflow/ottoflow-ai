/**
 * Runway Gen-4 image-to-video provider — real REST integration.
 *
 * Gen-4 is image-TO-video, not text-to-video. Our pipeline operates on
 * text scene descriptions, so we synthesize the required `promptImage`
 * by searching Pexels for a topic-matched still photo first. That keeps
 * the chain end-to-end real without depending on Imagen 3 (which 404s
 * on our v1beta API tier).
 *
 * Activates the moment `RUNWAYML_API_SECRET` lands in env. Until then,
 * isConfigured() returns false and the registry falls through.
 *
 * API shape (verified against docs.dev.runwayml.com, 2026-06-03):
 *   POST https://api.dev.runwayml.com/v1/image_to_video
 *     Headers: Authorization: Bearer <secret>
 *              X-Runway-Version: 2024-11-06
 *     Body:    { model, promptImage, promptText, ratio, duration }
 *   Polling: GET https://api.dev.runwayml.com/v1/tasks/{id}
 *     status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED"
 *     SUCCEEDED → output[0] is the MP4 URL
 *
 * Pricing (approx, gen4.5 5s vertical): ~$0.25/clip. More expensive than
 * Luma but higher cinematic quality. We try Runway first to get the best
 * visuals; Luma + Pexels are fallbacks.
 */
import { findStockPhotoByPrompt } from "@/lib/pexels";
import type { SceneRequest, SceneResult, VideoProvider } from "./types";

const RUNWAY_BASE = "https://api.dev.runwayml.com";
const RUNWAY_VERSION = "2024-11-06";
const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 240_000;

type RunwayStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "THROTTLED";

interface RunwayCreateResp {
  id: string;
}

interface RunwayTaskResp {
  id: string;
  status: RunwayStatus;
  failure?: string;
  failureCode?: string;
  output?: string[];
}

/** Map 9:16 / 16:9 / 1:1 → Runway's pixel-precise ratio strings. */
function runwayRatio(aspect: "9:16" | "16:9" | "1:1" | undefined): string {
  switch (aspect) {
    case "16:9":
      return "1280:720";
    case "1:1":
      return "960:960";
    case "9:16":
    default:
      return "720:1280";
  }
}

/** Runway durations: 5 or 10 seconds. */
function runwayDuration(target: number): 5 | 10 {
  return target >= 7 ? 10 : 5;
}

export class RunwayProvider implements VideoProvider {
  name = "runway";

  isConfigured(): boolean {
    // We also need Pexels for the promptImage seed. If Pexels isn't set
    // we can't generate a valid image-to-video request, so treat ourselves
    // as not configured.
    return !!process.env.RUNWAYML_API_SECRET && !!process.env.PEXELS_API_KEY;
  }

  async generateScene(request: SceneRequest): Promise<SceneResult> {
    const apiKey = process.env.RUNWAYML_API_SECRET;
    if (!apiKey) throw new Error("RUNWAYML_API_SECRET not configured");

    const startMs = Date.now();

    // ─── 0. Find a Pexels seed image matching the scene ─────────────────────
    // v2 F3 — forward brand/topic so the seed image is on-topic for the
    // brand's industry instead of relying on keyword extraction from the
    // raw scene description (which can drift into tech imagery for
    // brand-context-heavy topics like "AI for real estate").
    const orientation = request.aspectRatio === "16:9" ? "landscape" : "portrait";
    const photo = await findStockPhotoByPrompt({
      prompt: request.prompt,
      orientation,
      brandIndustry: request.brandIndustry ?? null,
      topicTitle: request.topicTitle ?? null,
      shotType: request.shotType ?? null,
    });
    if (!photo) {
      throw new Error(
        "Runway requires promptImage — Pexels photo search returned no match",
      );
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "X-Runway-Version": RUNWAY_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // ─── 1. Create image_to_video task ──────────────────────────────────────
    const duration = runwayDuration(request.durationSec);
    const ratio = runwayRatio(request.aspectRatio);
    // Phase 1A — per-scene seed restores cross-run variation. Same scene
    // description used twice now yields different Runway outputs.
    const runwaySeed = Math.floor(Math.random() * 2 ** 31);
    const createBody = {
      model: "gen4.5",
      promptImage: photo.src,
      promptText: request.prompt,
      ratio,
      duration,
      seed: runwaySeed,
    };
    const createRes = await fetch(`${RUNWAY_BASE}/v1/image_to_video`, {
      method: "POST",
      headers,
      body: JSON.stringify(createBody),
    });
    if (!createRes.ok) {
      const body = await createRes.text().catch(() => "");
      throw new Error(
        `Runway create ${createRes.status}: ${body.slice(0, 300) || createRes.statusText}`,
      );
    }
    const created = (await createRes.json()) as RunwayCreateResp;
    if (!created.id) {
      throw new Error("Runway create response had no id");
    }

    // ─── 2. Poll /v1/tasks/{id} ─────────────────────────────────────────────
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const pollRes = await fetch(
        `${RUNWAY_BASE}/v1/tasks/${created.id}`,
        { headers },
      );
      if (!pollRes.ok) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      const task = (await pollRes.json()) as RunwayTaskResp;
      if (task.status === "SUCCEEDED") {
        const videoUrl = task.output?.[0];
        if (!videoUrl) {
          throw new Error("Runway SUCCEEDED but output[0] missing");
        }
        const [widthStr, heightStr] = ratio.split(":");
        return {
          url: videoUrl,
          durationSec: duration,
          width: Number(widthStr),
          height: Number(heightStr),
          provider: this.name,
          costUsd: duration === 10 ? 0.5 : 0.25,
          metadata: {
            taskId: created.id,
            generationTimeMs: Date.now() - startMs,
            model: "gen4.5",
            seed: runwaySeed,
            seedPhoto: {
              id: photo.id,
              photographer: photo.photographer,
              pageUrl: photo.url,
            },
          },
        };
      }
      if (task.status === "FAILED" || task.status === "CANCELLED") {
        throw new Error(
          `Runway task ${task.status}: ${task.failure ?? task.failureCode ?? "unknown"}`,
        );
      }
      // PENDING / RUNNING / THROTTLED → keep polling
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    throw new Error(`Runway task timed out after ${POLL_TIMEOUT_MS}ms`);
  }
}
