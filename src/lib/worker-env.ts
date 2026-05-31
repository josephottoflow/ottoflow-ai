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

const WorkerSchema = z.object({
  // Required
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, "looks too short to be a real service-role key"),
  REDIS_URL: z
    .string()
    .min(1)
    .refine(
      (v) => /^rediss?:\/\//.test(v),
      "must start with redis:// or rediss:// (Upstash uses rediss://)"
    ),
  GOOGLE_API_KEY: z.string().min(10, "Google AI API key looks too short"),

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
] as const;
