/**
 * Centralized environment-variable validation for the Next.js app.
 *
 * Imported at app boot (root layout) so any missing/invalid variables fail
 * the process LOUDLY at startup with a clear remediation message — instead
 * of producing inscrutable runtime errors deep in a request handler.
 *
 * Worker process has its own validator: see ./worker-env.ts.
 *
 * Three execution contexts to handle:
 *
 *   1. Browser            — only NEXT_PUBLIC_* vars are present. Validate
 *                            that subset; server-only secrets are not in
 *                            scope.
 *   2. Server runtime     — all variables required. Throw if missing.
 *   3. Build phase        — Next.js prerenders pages during `next build`.
 *      (NEXT_PHASE)         Server-only secrets may not be present on the
 *                            build machine (Vercel injects them at runtime,
 *                            not build time). Use loud-named placeholders
 *                            so module init doesn't crash. NEXT_PUBLIC_*
 *                            vars are still required (Next inlines them
 *                            into the client bundle at build time).
 */
import { z } from "zod";

// ─── Schema ───────────────────────────────────────────────────────────────────

const PublicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, "looks too short to be a real anon key"),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z
    .string()
    .min(10, "expected a Clerk publishable key (pk_test_… or pk_live_…)")
    .refine((v) => v.startsWith("pk_"), "must start with pk_test_ or pk_live_"),
});

const ServerSchema = PublicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, "looks too short to be a real service-role key"),
  CLERK_SECRET_KEY: z
    .string()
    .min(10, "expected a Clerk secret key (sk_test_… or sk_live_…)")
    .refine((v) => v.startsWith("sk_"), "must start with sk_test_ or sk_live_"),
  REDIS_URL: z
    .string()
    .min(1)
    .refine(
      (v) => /^rediss?:\/\//.test(v),
      "must start with redis:// or rediss:// (Upstash uses rediss://)"
    ),
  // Optional but with documented defaults
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
});

export type PublicEnv = z.infer<typeof PublicSchema>;
export type ServerEnv = z.infer<typeof ServerSchema>;

// ─── Build-phase placeholders ─────────────────────────────────────────────────
// Used ONLY when NEXT_PHASE === "phase-production-build" so module init doesn't
// crash during prerender on machines where runtime secrets aren't present.
// Loud names so anyone debugging immediately understands what's happening.
const BUILD_PHASE_PLACEHOLDERS: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://placeholder-build-only.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "build-placeholder-anon-key-do-not-use-at-runtime",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_build_placeholder_not_for_runtime",
  SUPABASE_SERVICE_ROLE_KEY: "build-placeholder-service-role-key-do-not-use-at-runtime",
  CLERK_SECRET_KEY: "sk_test_build_placeholder_not_for_runtime",
  REDIS_URL: "redis://placeholder-build-only.invalid:6379",
};

// ─── Context detection ────────────────────────────────────────────────────────

const isBrowser = typeof window !== "undefined";
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

// ─── Validators ───────────────────────────────────────────────────────────────

function formatZodError(err: z.ZodError, scope: string): Error {
  const issues = err.errors
    .map((e) => `  • ${e.path.join(".") || "(root)"} — ${e.message}`)
    .join("\n");
  return new Error(
    `[env] ${scope} environment validation failed:\n${issues}\n\n` +
      `→ Local dev: copy .env.local.example to .env.local and fill in the missing values.\n` +
      `→ Production: set these in the platform dashboard. See docs/DEPLOYMENT.md.`
  );
}

function readPublic(): PublicEnv {
  const result = PublicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  });
  if (!result.success) throw formatZodError(result.error, "Public (NEXT_PUBLIC_*)");
  return result.data;
}

function readServer(): ServerEnv {
  // Merge build placeholders only during build phase, only for missing keys.
  const source: Record<string, string | undefined> = { ...process.env };
  if (isBuildPhase) {
    for (const [k, v] of Object.entries(BUILD_PHASE_PLACEHOLDERS)) {
      if (!source[k]) source[k] = v;
    }
  }
  const result = ServerSchema.safeParse(source);
  if (!result.success) throw formatZodError(result.error, "Server");
  return result.data;
}

// ─── Public exports ───────────────────────────────────────────────────────────

/**
 * Public (browser-safe) env. Eagerly validated. Available in client AND
 * server code.
 */
export const publicEnv: PublicEnv = readPublic();

/**
 * Full server-side env (includes secrets). Eagerly validated.
 *
 * In the browser this is a no-op that returns an empty object cast —
 * accessing any field is a programmer error and means a non-server-only
 * import path is leaking secrets.
 *
 * During the Next build phase, missing server-only secrets are replaced
 * with loud placeholders so module init doesn't crash. Real values are
 * required at runtime (the validator runs again on the first server
 * request when the cache is empty).
 */
export const serverEnv: ServerEnv = isBrowser
  ? // In the browser, return a Proxy that throws if any server-only field
    // is accessed — protects us from accidental leakage in client components.
    (new Proxy({} as ServerEnv, {
      get(_target, prop) {
        if (typeof prop === "string" && prop in PublicSchema.shape) {
          return (publicEnv as Record<string, unknown>)[prop];
        }
        throw new Error(
          `[env] Server env "${String(prop)}" accessed in the browser. ` +
            `Move this code to a server file ("use server", route handler, or server component).`
        );
      },
    }) as ServerEnv)
  : readServer();

/**
 * Variables required for the Next.js process (for docs / reporting).
 */
export const REQUIRED_NEXT_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CLERK_SECRET_KEY",
  "REDIS_URL",
] as const;

/**
 * Optional vars with defaults (for docs / reporting).
 */
export const OPTIONAL_NEXT_VARS = [
  { name: "GEMINI_MODEL", default: "gemini-2.5-flash" },
] as const;
