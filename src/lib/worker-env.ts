/**
 * Centralized environment-variable validation for the BullMQ worker process.
 *
 * Imported FIRST in worker/index.ts (before any other module that reads
 * process.env). If any required variable is missing/invalid, the worker
 * refuses to start with a clear error message.
 *
 * The worker uses a tighter subset of env than the Next.js app:
 *   - No Clerk vars (worker acts on behalf of users via service-role)
 *   - No NEXT_PUBLIC_*_ANON_KEY (worker uses service-role, not anon)
 *   - Adds GOOGLE_API_KEY (Gemini)
 *   - Adds WORKER_CONCURRENCY, GEMINI_TIMEOUT_MS
 *
 * There is no "build phase" concept for the worker — it always runs in
 * a real process with real env. Strict validation, no placeholders.
 */
import { z } from "zod";

// Any value that ends up in an HTTP header must be safe to pass to
// `Headers.set()` — no CR/LF, no NUL, no control characters. We've seen
// clipboard-paste corruption in deployment dashboards land control chars
// in env values; catch them at boot.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const isHeaderSafe = (v: string): boolean =>
  !CONTROL_CHARS.test(v) && v.length > 0 && v.length <= 4096;
const headerSafe = (msg: string) =>
  z
    .string()
    .refine(
      isHeaderSafe,
      `${msg} (contains control chars / newlines or exceeds 4096 chars — corrupted paste in env field?)`
    );

const WorkerSchema = z.object({
  // Required
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().pipe(headerSafe("invalid Supabase URL")),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, "looks too short to be a real service-role key")
    .max(2048, "looks too long to be a real service-role key (corrupted paste?)")
    .pipe(headerSafe("service-role key has invalid characters for an HTTP header")),
  REDIS_URL: z
    .string()
    .min(1)
    .refine(
      (v) => /^rediss?:\/\//.test(v),
      "must start with redis:// or rediss:// (Upstash uses rediss://)"
    )
    .pipe(headerSafe("Redis URL has invalid characters")),
  GOOGLE_API_KEY: z
    .string()
    .min(10, "Google AI API key looks too short")
    .max(2048, "Google AI API key looks too long (corrupted paste?)")
    .pipe(headerSafe("Google API key has invalid characters")),

  // Optional with defaults
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(90_000),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),

  // Optional logging
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),

  // ─── Scene-generation providers (Video Pipeline v2 F2) ───────────────────
  // All three are OPTIONAL at the schema level so the worker can boot to
  // serve brand-research + content-generation even when scene gen is
  // disabled. worker/index.ts logs a structured warning at boot if all
  // three are unset (the video-merge processor will degrade to single-clip
  // Pexels fallback for every job — see VIDEO_TIMELINE_AUDIT.md).
  //
  // At least ONE of these should be set in production. PEXELS_API_KEY is
  // the cheapest path and produces working (if generic) results.
  RUNWAYML_API_SECRET: z
    .string()
    .min(10, "Runway secret looks too short")
    .pipe(headerSafe("Runway secret has invalid characters for an HTTP header"))
    .optional(),
  LUMA_API_KEY: z
    .string()
    .min(10, "Luma key looks too short")
    .pipe(headerSafe("Luma key has invalid characters for an HTTP header"))
    .optional(),
  PEXELS_API_KEY: z
    .string()
    .min(10, "Pexels key looks too short")
    .pipe(headerSafe("Pexels key has invalid characters for an HTTP header"))
    .optional(),

  // ─── Remotion render tuning (ADR-001 Phase 3) ────────────────────────────
  // Hard cap on a single renderMedia() call. Catches Chrome hangs and asset
  // 403s that would otherwise consume BullMQ's stalled-job recovery window.
  // Spike rendered 24s of video in 78s; production target 30-60s should
  // finish in ~100-200s. 5-min default gives generous headroom.
  REMOTION_RENDER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(300_000),
  // Optional override — point Remotion at a specific Chrome binary instead
  // of the auto-downloaded Chrome Headless Shell. Useful when nix's
  // chromium package is preferable (smaller deploy diff, no cache eviction
  // risk across Railway redeploys). Leave unset to use the cached binary
  // in ~/.cache/remotion (pre-warmed by `npx remotion browser ensure` in
  // nixpacks.toml [phases.build]).
  REMOTION_CHROME_EXECUTABLE: z.string().min(1).optional(),

  // ─── ADR-002 — FFmpeg multi-agent pipeline ───────────────────────────────
  // Extra stock-footage sources (Agent 4). All optional — the multi-source
  // search agent skips an unconfigured source and uses the rest. Pexels
  // (above) is the baseline; these add breadth + reduce repetition.
  PIXABAY_API_KEY: z
    .string()
    .min(10, "Pixabay key looks too short")
    .pipe(headerSafe("Pixabay key has invalid characters for an HTTP header"))
    .optional(),
  COVERR_API_KEY: z
    .string()
    .min(10, "Coverr key looks too short")
    .pipe(headerSafe("Coverr key has invalid characters for an HTTP header"))
    .optional(),
  // Mixkit has no API — we scrape with a polite UA. Override the default UA
  // here if Mixkit starts blocking the built-in one.
  MIXKIT_USER_AGENT: z.string().min(1).optional(),

  // Cloudflare R2 (primary video storage). All five must be set together
  // for R2 uploads to work; r2.isR2Configured() checks presence. When unset,
  // the compose worker falls back to Google Drive (if a token is supplied)
  // or fails loudly with a clear "no storage configured" error.
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z
    .string()
    .min(10)
    .pipe(headerSafe("R2 access key id has invalid characters"))
    .optional(),
  R2_SECRET_ACCESS_KEY: z
    .string()
    .min(10)
    .pipe(headerSafe("R2 secret access key has invalid characters"))
    .optional(),
  R2_BUCKET: z.string().min(1).optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),

  // Google Drive fallback — folder to drop exports into (optional). The
  // access token itself is per-user and travels in the job payload, not env.
  GDRIVE_FOLDER_ID: z.string().min(1).optional(),
});

export type WorkerEnv = z.infer<typeof WorkerSchema>;

function format(err: z.ZodError): Error {
  const issues = err.errors
    .map((e) => `  • ${e.path.join(".") || "(root)"} — ${e.message}`)
    .join("\n");
  return new Error(
    `[worker-env] Worker environment validation failed:\n${issues}\n\n` +
      `→ Local: set these in ottoflow-ai/.env.local before running \`npm run dev:worker\`.\n` +
      `→ Production (Railway): set them in the worker service → Variables tab.\n` +
      `   See docs/DEPLOYMENT.md for the full list.`
  );
}

function parse(): WorkerEnv {
  const result = WorkerSchema.safeParse(process.env);
  if (!result.success) throw format(result.error);
  return result.data;
}

/**
 * Validated worker env. Importing this module triggers validation; if any
 * required variable is missing, the process exits before the worker starts.
 */
export const workerEnv: WorkerEnv = parse();

/**
 * For docs / DEPLOYMENT.md generation.
 */
export const REQUIRED_WORKER_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "REDIS_URL",
  "GOOGLE_API_KEY",
] as const;

export const OPTIONAL_WORKER_VARS = [
  { name: "GEMINI_MODEL", default: "gemini-2.5-flash" },
  { name: "GEMINI_TIMEOUT_MS", default: "90000" },
  { name: "WORKER_CONCURRENCY", default: "2" },
  { name: "LOG_LEVEL", default: "info" },
  // Scene-gen providers — at least one should be set OR the video-merge
  // processor degrades to a single Pexels clip for every job.
  { name: "RUNWAYML_API_SECRET", default: "(scene gen disabled if unset)" },
  { name: "LUMA_API_KEY", default: "(scene gen disabled if unset)" },
  { name: "PEXELS_API_KEY", default: "(scene gen disabled if unset)" },
] as const;
