/**
 * Seedance 2.0 provider — AtlasCloud backend (text-to-video).
 *
 * NOTE: the model is still ByteDance Seedance 2.0; only the API *wrapper* is
 * AtlasCloud's (`api.atlascloud.ai`), NOT BytePlus/Volcengine ModelArk. The
 * provider keeps `name = "seedance"` and the same exported surface so registry
 * wiring, scene-generation, SourceName, cost.ts and route labels are unchanged
 * (Option B — minimal surface; a dedicated atlascloud.ts is a Phase-2 cleanup).
 *
 * Scene GENERATOR only: returns a single clip URL per scene. No branding, no
 * captions, no audio mixing — FFmpeg (Agents 11/12) owns composition. Slots
 * into the existing VideoProvider chain exactly like runway.ts / luma.ts.
 *
 * AtlasCloud contract (Seedance 2.0 T2V), async create → poll → download:
 *   POST  {BASE}/api/v1/model/generateVideo
 *         body { model, prompt, duration, resolution, ratio,
 *                generate_audio:false, watermark:false }
 *         → { data: { id } }
 *   GET   {BASE}/api/v1/model/prediction/{id}
 *         → { data: { status, outputs:[<video_url>] } }
 *   status "completed" | "succeeded" → outputs[0]; "failed" → error.
 *
 * Cloudflare: AtlasCloud is fronted by Cloudflare, which blocks non-browser
 * clients (403 / "error code 1010"). We send a browser User-Agent on every
 * call. Override with ATLASCLOUD_USER_AGENT if needed.
 *
 * Config is env-overridable; SEEDANCE_* names are accepted as fallbacks so any
 * pre-existing wiring keeps working. No live call unless an API key is set
 * (isConfigured()=false otherwise → registry skips cleanly).
 *
 * Pricing (AtlasCloud, verify at provisioning): ~$0.081/s Fast, ~$0.10/s
 * standard. We bill the standard rate as a conservative upper bound for the
 * pre-render cost-approval gate. Default 720p for cost.
 */
import type { SceneRequest, SceneResult, VideoProvider } from "./types";

const ATLAS_BASE = (
  process.env.ATLASCLOUD_BASE_URL ??
  process.env.SEEDANCE_BASE_URL ??
  "https://api.atlascloud.ai"
).replace(/\/$/, "");
const ATLAS_MODEL =
  process.env.ATLASCLOUD_MODEL ??
  process.env.SEEDANCE_MODEL ??
  "bytedance/seedance-2.0/text-to-video";
/** Create + poll paths (AtlasCloud); env-overridable for forward-compat. */
const GENERATE_PATH = process.env.ATLASCLOUD_GENERATE_PATH ?? "/api/v1/model/generateVideo";
const PREDICTION_PATH = process.env.ATLASCLOUD_PREDICTION_PATH ?? "/api/v1/model/prediction";
const RESOLUTION =
  process.env.ATLASCLOUD_RESOLUTION ?? process.env.SEEDANCE_RESOLUTION ?? "720p";
/** Browser UA so Cloudflare doesn't 403/1010 a server-side fetch. */
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const USER_AGENT = process.env.ATLASCLOUD_USER_AGENT ?? DEFAULT_UA;
const POLL_INTERVAL_MS = 4_000;
// Live runs show AtlasCloud Seedance often exceeds 180s under load → scenes were
// falling through to Pexels. 360s keeps generation on Seedance. Env-overridable.
const POLL_TIMEOUT_MS = Number(process.env.ATLASCLOUD_POLL_TIMEOUT_MS) || 360_000;

/** Read the API key (ATLASCLOUD_* primary, SEEDANCE_* fallback). */
function apiKey(): string | undefined {
  return process.env.ATLASCLOUD_API_KEY ?? process.env.SEEDANCE_API_KEY;
}

/** AtlasCloud prediction lifecycle. Terminal-failure handled in pollTask. */
type AtlasStatus =
  | "queued"
  | "starting"
  | "processing"
  | "running"
  | "succeeded"
  | "completed"
  | "failed"
  | "canceled"
  | "cancelled";

const TERMINAL_SUCCESS: readonly AtlasStatus[] = ["succeeded", "completed"];
const TERMINAL_FAILURE: readonly AtlasStatus[] = ["failed", "canceled", "cancelled"];

/** Per-second USD estimate. Single source of truth for the pre-render cost
 * estimator (src/lib/video/cost.ts) and the post-gen ledger. Conservative
 * (standard-tier) upper bound for the approval gate. */
export function seedancePerSecondUsd(): number {
  // CALIBRATED from production render b1807d29 (Sprint 1A): balance moved
  // $26.82608 → $21.94736 = $4.879 for 4×5s billable = $0.244/s effective —
  // 2.4× the prior $0.10 guess. Rounded up to $0.25/s as a conservative figure
  // for the cost-approval gate + balance preflight (estimates should err high,
  // never low). Recalibrate if AtlasCloud Seedance pricing changes or for 1080p.
  return 0.25;
}

/**
 * Read the AtlasCloud account's available USD balance for the balance preflight
 * (Sprint 1A). Reuses the same base + auth + browser UA as the generation calls.
 *
 * FAIL-OPEN by contract: returns `null` on ANY problem (no key on this surface,
 * Cloudflare block, network error, unparseable body) so callers proceed exactly
 * as before — this can only ADD a guard, never break an otherwise-valid render.
 * Returns the numeric balance only on a confirmed successful read.
 */
export async function getSeedanceBalanceUsd(): Promise<number | null> {
  const key = apiKey();
  if (!key) return null;
  // Sprint 1B: bound the preflight so a slow/hanging AtlasCloud can't stall the
  // approve request (up to the route's maxDuration). On abort the fetch throws →
  // caught below → null → FAIL-OPEN (render proceeds), behaviour unchanged.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${ATLAS_BASE}/api/v1/credit/balance`, {
      method: "GET",
      headers: authHeaders(key),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as
      | { data?: { balance?: string | number; amount?: string | number } }
      | null;
    const raw = body?.data?.balance ?? body?.data?.amount;
    const n = typeof raw === "string" ? Number(raw) : raw;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface AtlasCreateResp {
  data?: { id?: string; task_id?: string };
  id?: string;
  task_id?: string;
}

interface AtlasPredictionResp {
  data?: {
    id?: string;
    status?: string;
    task_status?: string;
    outputs?: Array<string | { url?: string }>;
    task_result?: { videos?: Array<{ url?: string }> };
  };
  status?: string;
  outputs?: Array<string | { url?: string }>;
  error?: { code?: string; message?: string } | string;
}

/** Map 9:16 / 16:9 / 1:1 → AtlasCloud ratio strings (pass-through). */
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

/** Clamp/round a target duration into AtlasCloud's supported 4–15 s window.
 * Exported so the cost estimator bills the SAME seconds the provider charges. */
export function seedanceDuration(target: number): number {
  if (!Number.isFinite(target)) return 5;
  return Math.min(15, Math.max(4, Math.round(target)));
}

/** Pixel dims for the returned ratio at the configured resolution tier. */
function dimsFor(ratio: string): { width: number; height: number } {
  const short = RESOLUTION === "1080p" ? 1080 : RESOLUTION === "480p" ? 480 : 720;
  const long = Math.round((short * 16) / 9);
  if (ratio === "16:9") return { width: long, height: short };
  if (ratio === "1:1") return { width: short, height: short };
  return { width: short, height: long }; // 9:16
}

function authHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
}

/** Structured log line (consistent with the worker's JSON logging). */
function slog(event: string, extra?: Record<string, unknown>): void {
  console.log(JSON.stringify({ scope: "seedance", event, backend: "atlascloud", ...extra }));
}

/** Detect a Cloudflare bot-block so the error is actionable (set a browser UA). */
function looksLikeCloudflareBlock(status: number, body: string): boolean {
  return (
    status === 403 &&
    (/error code: ?1010/i.test(body) || /cloudflare/i.test(body) || /just a moment/i.test(body))
  );
}

/**
 * Create an AtlasCloud Seedance 2.0 generation task. Returns the prediction id.
 * `prompt` carries the abstract-safe scene description (brand-palette + metaphor
 * seeded upstream). Brand logo/headshot are NEVER sent — branding stays
 * deterministic in FFmpeg. `generate_audio:false` (FFmpeg owns audio).
 */
export async function createTask(req: SceneRequest, key: string): Promise<string> {
  const ratio = seedanceRatio(req.aspectRatio);
  const duration = seedanceDuration(req.durationSec);
  const body = {
    model: ATLAS_MODEL,
    prompt: req.prompt.trim(),
    duration,
    resolution: RESOLUTION,
    ratio,
    generate_audio: false,
    watermark: false,
    // Seed the generation for look continuity across the 4 scenes. Was computed
    // upstream (video-strategy) but previously never sent — so it had no effect.
    // AtlasCloud ignores unknown fields, so this is safe even if unsupported.
    ...(typeof req.seed === "number" ? { seed: req.seed } : {}),
  };
  const url = `${ATLAS_BASE}${GENERATE_PATH}`;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(key),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (looksLikeCloudflareBlock(res.status, text)) {
      throw new Error(
        `AtlasCloud create blocked by Cloudflare (403/1010) @ ${url} — set a browser ATLASCLOUD_USER_AGENT.`,
      );
    }
    throw new Error(
      `AtlasCloud create ${res.status} ${res.statusText} @ ${url}: ${text.slice(0, 400)}`,
    );
  }
  const created = (await res.json().catch(() => null)) as AtlasCreateResp | null;
  const id = created?.data?.id ?? created?.id ?? created?.data?.task_id ?? created?.task_id;
  if (!id) {
    throw new Error(
      "AtlasCloud create response had no prediction id (check ATLASCLOUD_MODEL / contract)",
    );
  }
  slog("task.created", { predictionId: id, model: ATLAS_MODEL, ratio, duration });
  return id;
}

/** Defensively extract the output MP4 URL from a prediction body. */
function extractOutputUrl(resp: AtlasPredictionResp): string | null {
  const d = resp.data ?? resp;
  const out = d.outputs ?? resp.outputs;
  const first = Array.isArray(out) ? out[0] : undefined;
  const fromOutputs = typeof first === "string" ? first : first?.url;
  const fromTaskResult = resp.data?.task_result?.videos?.[0]?.url;
  return fromOutputs ?? fromTaskResult ?? null;
}

/**
 * Poll a prediction until it succeeds (returns the MP4 URL) or fails / times
 * out. Transient non-2xx polls are retried (AtlasCloud occasionally 5xx's
 * mid-run).
 */
export async function pollTask(predictionId: string, key: string): Promise<string> {
  const headers = authHeaders(key);
  const url = `${ATLAS_BASE}${PREDICTION_PATH}/${predictionId}`;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    const resp = (await res.json().catch(() => null)) as AtlasPredictionResp | null;
    if (!resp) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    const status = (resp.data?.status ?? resp.status ?? resp.data?.task_status ?? "")
      .toString()
      .toLowerCase() as AtlasStatus;

    if (TERMINAL_SUCCESS.includes(status)) {
      const outUrl = extractOutputUrl(resp);
      if (!outUrl || !/^https?:\/\//i.test(outUrl)) {
        throw new Error(
          `AtlasCloud succeeded but outputs URL is missing/invalid: ${JSON.stringify(
            resp.data ?? resp,
          ).slice(0, 200)}`,
        );
      }
      slog("task.succeeded", { predictionId });
      return outUrl;
    }
    if (TERMINAL_FAILURE.includes(status)) {
      const err =
        typeof resp.error === "string"
          ? resp.error
          : resp.error?.message ?? resp.error?.code ?? "unknown";
      throw new Error(`AtlasCloud prediction ${status}: ${err}`);
    }
    // queued / starting / processing / running (or unknown) → keep polling.
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`AtlasCloud prediction ${predictionId} timed out after ${POLL_TIMEOUT_MS}ms`);
}

/**
 * Extract the output MP4 URL from a succeeded prediction body. The worker
 * performs the byte download + R2 copy (provider URLs expire) — consistent with
 * how runway/luma return a CDN URL the merge step fetches.
 */
export function downloadResult(task: AtlasPredictionResp): string | null {
  return extractOutputUrl(task);
}

export class SeedanceProvider implements VideoProvider {
  name = "seedance";

  isConfigured(): boolean {
    return !!apiKey();
  }

  async generateScene(request: SceneRequest): Promise<SceneResult> {
    const key = apiKey();
    if (!key) throw new Error("ATLASCLOUD_API_KEY (or SEEDANCE_API_KEY) not configured");

    const startMs = Date.now();
    const ratio = seedanceRatio(request.aspectRatio);
    const duration = seedanceDuration(request.durationSec);

    const predictionId = await createTask(request, key);
    const url = await pollTask(predictionId, key);

    const { width, height } = dimsFor(ratio);
    return {
      url,
      durationSec: duration,
      width,
      height,
      provider: this.name,
      // Estimate; shared rate so the pre-render approval gate and this ledger agree.
      costUsd: duration * seedancePerSecondUsd(),
      metadata: {
        predictionId,
        generationTimeMs: Date.now() - startMs,
        backend: "atlascloud",
        model: ATLAS_MODEL,
        resolution: RESOLUTION,
        seed: request.seed ?? null,
      },
    };
  }
}

// ─── Contract validation (config-level; NO network call) ──────────────────────
/**
 * Static, offline validation of the AtlasCloud integration contract. Confirms
 * the settings a live call depends on are present and well-formed WITHOUT making
 * a request (so it costs nothing and cannot trigger a render):
 *
 *   - base URL          parses as http(s)
 *   - model id          set (AtlasCloud Seedance 2.0 id)
 *   - generate path     starts with "/"
 *   - resolution tier   one of 480p/720p/1080p
 *   - api key present   ATLASCLOUD_API_KEY or SEEDANCE_API_KEY
 *   - user-agent        present (Cloudflare requires a browser UA)
 *
 * The RESPONSE-shape fields (data.outputs[0], status values) cannot be proven
 * without a live prediction; `responseContractVerified=false` until an operator
 * runs one approved probe. This function never does that.
 */
export interface SeedanceContractReport {
  ok: boolean;
  issues: string[];
  config: {
    baseUrl: string;
    model: string;
    generatePath: string;
    predictionPath: string;
    resolution: string;
    apiKeyPresent: boolean;
    userAgentPresent: boolean;
    pollIntervalMs: number;
    pollTimeoutMs: number;
  };
  statusEnum: AtlasStatus[];
  successField: string;
  responseContractVerified: false;
}

export function validateSeedanceContract(): SeedanceContractReport {
  const issues: string[] = [];

  try {
    const u = new URL(ATLAS_BASE);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      issues.push(`ATLASCLOUD_BASE_URL has non-http(s) protocol: ${u.protocol}`);
    }
  } catch {
    issues.push(`ATLASCLOUD_BASE_URL is not a valid URL: ${ATLAS_BASE}`);
  }

  if (!ATLAS_MODEL) issues.push("ATLASCLOUD_MODEL is not set");
  if (!GENERATE_PATH.startsWith("/")) {
    issues.push(`ATLASCLOUD_GENERATE_PATH must start with '/': ${GENERATE_PATH}`);
  }
  if (!["480p", "720p", "1080p"].includes(RESOLUTION)) {
    issues.push(`ATLASCLOUD_RESOLUTION is not a known tier (480p/720p/1080p): ${RESOLUTION}`);
  }
  if (!apiKey()) issues.push("ATLASCLOUD_API_KEY (or SEEDANCE_API_KEY) is not set");
  if (!USER_AGENT) issues.push("ATLASCLOUD_USER_AGENT is empty (Cloudflare needs a browser UA)");

  return {
    ok: issues.length === 0,
    issues,
    config: {
      baseUrl: ATLAS_BASE,
      model: ATLAS_MODEL,
      generatePath: GENERATE_PATH,
      predictionPath: PREDICTION_PATH,
      resolution: RESOLUTION,
      apiKeyPresent: !!apiKey(),
      userAgentPresent: !!USER_AGENT,
      pollIntervalMs: POLL_INTERVAL_MS,
      pollTimeoutMs: POLL_TIMEOUT_MS,
    },
    statusEnum: [
      "queued",
      "starting",
      "processing",
      "running",
      "succeeded",
      "completed",
      "failed",
      "canceled",
      "cancelled",
    ],
    successField: "data.outputs[0]",
    responseContractVerified: false,
  };
}
