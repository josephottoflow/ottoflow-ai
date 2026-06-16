/**
 * Seedance 2.0 provider — ByteDance/BytePlus ModelArk text-to-video.
 *
 * Scene GENERATOR only: returns a single clip URL per scene. No branding, no
 * captions, no audio mixing — FFmpeg (Agents 11/12) owns composition. Slots
 * into the existing VideoProvider chain exactly like runway.ts / luma.ts.
 *
 * Async task API (Volcengine/BytePlus ModelArk Ark video generation): create a
 * task → poll until it succeeds → read the output MP4 URL. Mirrors the
 * create→poll shape already used by Runway and Luma.
 *
 * Contract verified against the Ark video API (POST /api/v3/contents/
 * generations/tasks): generation params (ratio/resolution/duration/seed) are
 * passed as `--key value` SUFFIXES on the text prompt inside a `content`
 * array — NOT as flat JSON fields. Response status lifecycle is
 * queued→running→succeeded|failed|cancelled; the MP4 is at content.video_url.
 *
 * The base URL + model id are account/region-specific → env-overridable.
 * SEEDANCE_MODEL MUST be set to the operator's real model/endpoint id;
 * SEEDANCE_BASE_URL to their region host. No live call unless SEEDANCE_API_KEY
 * is set (isConfigured()=false otherwise → registry skips cleanly).
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

/** Structured log line (consistent with the worker's JSON logging). */
function slog(event: string, extra?: Record<string, unknown>): void {
  console.log(JSON.stringify({ scope: "seedance", event, ...extra }));
}

/**
 * Build the Ark text command: prompt + `--key value` parameter suffixes.
 * (Ark passes ratio/resolution/duration/seed this way, not as JSON fields.)
 */
function buildCommandText(req: SceneRequest, ratio: string, duration: number): string {
  const parts = [
    req.prompt.trim(),
    `--ratio ${ratio}`,
    `--resolution ${RESOLUTION}`,
    `--duration ${duration}`,
  ];
  if (typeof req.seed === "number") parts.push(`--seed ${req.seed}`);
  return parts.join(" ");
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
  const duration = seedanceDuration(req.durationSec);
  // Ark contract: a `content` array of typed parts; params as text suffixes.
  const body = {
    model: SEEDANCE_MODEL,
    content: [{ type: "text", text: buildCommandText(req, ratio, duration) }],
  };
  const res = await fetch(`${SEEDANCE_BASE}${TASKS_PATH}`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Seedance create ${res.status} ${res.statusText} @ ${SEEDANCE_BASE}${TASKS_PATH}: ${text.slice(0, 400)}`,
    );
  }
  const created = (await res.json().catch(() => null)) as SeedanceCreateResp | null;
  if (!created?.id) {
    throw new Error("Seedance create response had no task id (check SEEDANCE_MODEL / contract)");
  }
  slog("task.created", { taskId: created.id, model: SEEDANCE_MODEL, ratio, duration });
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
    const task = (await res.json().catch(() => null)) as SeedanceTaskResp | null;
    if (!task) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    if (task.status === "succeeded") {
      const url = downloadResult(task);
      // Defensive: the result MUST be a usable absolute http(s) URL.
      if (!url || !/^https?:\/\//i.test(url)) {
        throw new Error(
          `Seedance succeeded but content.video_url is missing/invalid: ${JSON.stringify(task.content ?? null).slice(0, 200)}`,
        );
      }
      slog("task.succeeded", { taskId });
      return url;
    }
    if (task.status === "failed" || task.status === "cancelled") {
      throw new Error(
        `Seedance task ${task.status}: ${task.error?.message ?? task.error?.code ?? "unknown"}`,
      );
    }
    // queued / running (or an unknown status) → keep polling within deadline.
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Seedance task ${taskId} timed out after ${POLL_TIMEOUT_MS}ms`);
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
