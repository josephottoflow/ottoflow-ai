/**
 * Seedance 2.0 provider — ByteDance/BytePlus ModelArk text-to-video.
 *
 * Scene GENERATOR only: returns a single clip URL per scene. No branding, no
 * captions, no audio mixing — FFmpeg (Agents 11/12) owns composition. Slots
 * into the existing VideoProvider chain exactly like runway.ts / luma.ts.
 *
 * Async task API (BytePlus ModelArk): create a generation task → poll the
 * task until it succeeds → read the output MP4 URL. Mirrors the create→poll
 * shape already used by Runway and Luma.
 *
 * ⚠ The exact ModelArk endpoint/host + request/response field names must be
 * confirmed against the BytePlus ModelArk console at provisioning time. To
 * avoid baking an unverified contract into code, the base URL, model id, and
 * task-path are env-overridable. Defaults target the ModelArk v3 task API;
 * set SEEDANCE_BASE_URL / SEEDANCE_MODEL from the console if they differ.
 * No live call is made unless SEEDANCE_API_KEY is set (isConfigured()=false
 * otherwise → the registry skips this provider cleanly).
 *
 * Pricing (estimate, verify at provisioning): ~$0.01–0.02/s @720p,
 * ~$0.05–0.10/s @1080p. We default to 720p for cost.
 */
import type { SceneRequest, SceneResult, VideoProvider } from "./types";

const SEEDANCE_BASE =
  process.env.SEEDANCE_BASE_URL ?? "https://ark.ap-southeast.bytepluses.com/api/v3";
const SEEDANCE_MODEL = process.env.SEEDANCE_MODEL ?? "seedance-2-0-t2v";
/** Path for create/list; a task id is appended for retrieve/cancel. */
const TASKS_PATH = process.env.SEEDANCE_TASKS_PATH ?? "/contents/generations/tasks";
const RESOLUTION = process.env.SEEDANCE_RESOLUTION ?? "720p";
const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 180_000; // Seedance typical 30–120s; 180s headroom.

type SeedanceStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

interface SeedanceCreateResp {
  id: string;
}

interface SeedanceTaskResp {
  id: string;
  status: SeedanceStatus;
  /** Output location on success. Field name verified at provisioning. */
  content?: { video_url?: string };
  error?: { code?: string; message?: string };
}

/** Map 9:16 / 16:9 / 1:1 → Seedance ratio strings. */
function seedanceRatio(aspect: "9:16" | "16:9" | "1:1" | undefined): string {
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

/** Round to a Seedance-supported duration (4,5,6,8,10,12,15). */
function seedanceDuration(target: number): number {
  const supported = [4, 5, 6, 8, 10, 12, 15];
  return supported.reduce((best, v) =>
    Math.abs(v - target) < Math.abs(best - target) ? v : best,
  );
}

/** Pixel dims for the returned ratio at the configured resolution tier. */
function dimsFor(ratio: string): { width: number; height: number } {
  const short = RESOLUTION === "1080p" ? 1080 : RESOLUTION === "480p" ? 480 : 720;
  const long = Math.round((short * 16) / 9);
  if (ratio === "16:9") return { width: long, height: short };
  if (ratio === "1:1") return { width: short, height: short };
  return { width: short, height: long }; // 9:16
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/**
 * Create a Seedance generation task. Returns the task id.
 * `prompt` carries the abstract-safe scene description (brand-palette +
 * metaphor seeded upstream). Brand logo/headshot are NEVER sent to Seedance —
 * branding stays deterministic in FFmpeg.
 */
export async function createTask(
  req: SceneRequest,
  apiKey: string,
): Promise<string> {
  const ratio = seedanceRatio(req.aspectRatio);
  const body = {
    model: SEEDANCE_MODEL,
    prompt: req.prompt,
    ratio,
    duration: seedanceDuration(req.durationSec),
    resolution: RESOLUTION,
    ...(typeof req.seed === "number" ? { seed: req.seed } : {}),
  };
  const res = await fetch(`${SEEDANCE_BASE}${TASKS_PATH}`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Seedance create ${res.status}: ${text.slice(0, 300) || res.statusText}`,
    );
  }
  const created = (await res.json()) as SeedanceCreateResp;
  if (!created.id) throw new Error("Seedance create response had no task id");
  return created.id;
}

/**
 * Poll a task until it succeeds (returns the MP4 URL) or fails/ times out.
 * Transient non-2xx polls are retried (Seedance occasionally 5xx's mid-run).
 */
export async function pollTask(taskId: string, apiKey: string): Promise<string> {
  const headers = authHeaders(apiKey);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${SEEDANCE_BASE}${TASKS_PATH}/${taskId}`, { headers });
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    const task = (await res.json()) as SeedanceTaskResp;
    if (task.status === "succeeded") {
      const url = downloadResult(task);
      if (!url) throw new Error("Seedance succeeded but no video_url present");
      return url;
    }
    if (task.status === "failed" || task.status === "cancelled") {
      throw new Error(
        `Seedance task ${task.status}: ${task.error?.message ?? task.error?.code ?? "unknown"}`,
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Seedance task timed out after ${POLL_TIMEOUT_MS}ms`);
}

/**
 * Extract the output MP4 URL from a succeeded task. The worker performs the
 * actual byte download + R2 copy (provider URLs expire ~1h) — consistent with
 * how runway/luma return a CDN URL the merge step fetches.
 */
export function downloadResult(task: SeedanceTaskResp): string | null {
  return task.content?.video_url ?? null;
}

export class SeedanceProvider implements VideoProvider {
  name = "seedance";

  isConfigured(): boolean {
    return !!process.env.SEEDANCE_API_KEY;
  }

  async generateScene(request: SceneRequest): Promise<SceneResult> {
    const apiKey = process.env.SEEDANCE_API_KEY;
    if (!apiKey) throw new Error("SEEDANCE_API_KEY not configured");

    const startMs = Date.now();
    const ratio = seedanceRatio(request.aspectRatio);
    const duration = seedanceDuration(request.durationSec);

    const taskId = await createTask(request, apiKey);
    const url = await pollTask(taskId, apiKey);

    const { width, height } = dimsFor(ratio);
    return {
      url,
      durationSec: duration,
      width,
      height,
      provider: this.name,
      // Estimate; refine once real per-second pricing is confirmed.
      costUsd: duration * (RESOLUTION === "1080p" ? 0.07 : 0.015),
      metadata: {
        taskId,
        generationTimeMs: Date.now() - startMs,
        model: SEEDANCE_MODEL,
        resolution: RESOLUTION,
        seed: request.seed ?? null,
      },
    };
  }
}
