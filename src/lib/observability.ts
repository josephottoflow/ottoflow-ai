/**
 * Observability shim.
 *
 * Purpose: give every "we caught a problem and fell back" call-site (the
 * defensive layers — gemini retries, supabase-server token rejection, db
 * safe() wrappers, worker stalled handlers) a SINGLE function to call,
 * without coupling those files to a specific telemetry vendor.
 *
 * Design:
 *   - This module has **no transitive dependency on @sentry/nextjs or
 *     @sentry/node**. That keeps the worker's esbuild bundle free of
 *     Next.js-specific code, and lets the same source files run in both
 *     the Next.js process and the Railway worker.
 *   - At process boot, ONE of two integrations registers handlers via
 *     `setObservabilityHandlers()`:
 *        - Next.js: `sentry.server.config.ts` / `sentry.edge.config.ts` /
 *                   `instrumentation-client.ts` register `@sentry/nextjs`.
 *        - Worker:  `worker/observability.ts` registers `@sentry/node`.
 *     Until then, every call is a pure console log — preserving today's
 *     behavior. Adding SENTRY_DSN to env is the only switch needed.
 *   - Console logging is preserved even when Sentry is wired, so Vercel
 *     and Railway runtime logs still surface the same lines they do today.
 *
 * Singleton storage:
 *   Handler refs live on `globalThis`, NOT module-level closures. Next.js
 *   bundles each serverless function (and each route) separately; a
 *   module-level `let` ends up duplicated across bundles, so a handler
 *   registered by the instrumentation hook in bundle A is invisible from
 *   bundle B's copy. Verified in production via /api/debug/sentry-test:
 *   first iteration with closure storage returned shim.wired:false even
 *   though Sentry.init() had clearly run (sdk.active was true).
 *
 *   Using `globalThis.__ottoflow_observability__` shares the registration
 *   across every bundle that runs in the same Node.js process — exactly
 *   how @sentry/nextjs itself keeps its client state global. Safe in the
 *   Edge runtime too (globalThis exists; this module is loaded by both
 *   server and edge config files).
 *
 * Call sites must NEVER throw from observability — telemetry is best-effort
 * and must not derail user-visible code paths.
 */

export type CaptureHandler = (
  label: string,
  err: unknown,
  ctx?: Record<string, unknown>
) => void;

export type BreadcrumbHandler = (
  category: string,
  message: string,
  data?: Record<string, unknown>
) => void;

type HandlerState = {
  capture: CaptureHandler | null;
  breadcrumb: BreadcrumbHandler | null;
};

const STORAGE_KEY = "__ottoflow_observability__";

// Typed view onto globalThis — we don't pollute the global namespace
// with unrelated keys; we just stash one well-named bag.
type Global = typeof globalThis & {
  [STORAGE_KEY]?: HandlerState;
};

function getState(): HandlerState {
  const g = globalThis as Global;
  if (!g[STORAGE_KEY]) {
    g[STORAGE_KEY] = { capture: null, breadcrumb: null };
  }
  return g[STORAGE_KEY];
}

export function setObservabilityHandlers(handlers: {
  capture?: CaptureHandler;
  breadcrumb?: BreadcrumbHandler;
}): void {
  const state = getState();
  if (handlers.capture) state.capture = handlers.capture;
  if (handlers.breadcrumb) state.breadcrumb = handlers.breadcrumb;
}

/** True once a telemetry backend has registered. Useful for health probes. */
export function isObservabilityWired(): boolean {
  return getState().capture !== null;
}

function formatErr(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/**
 * Record that a defensive layer caught a problem and fell back to a safe
 * default. Always logs to console (preserves current behavior); also
 * forwards to the registered telemetry handler if one is wired.
 *
 * `label` should be a stable string identifier ("gemini.retry.exhausted",
 * "supabase-server.token.invalid", "db.getProjects.threw") so the
 * telemetry backend can group events.
 */
export function captureFallback(
  label: string,
  err: unknown,
  ctx?: Record<string, unknown>
): void {
  const errPart = formatErr(err);
  const ctxPart =
    ctx && Object.keys(ctx).length ? ` ctx=${JSON.stringify(ctx)}` : "";
  console.error(`[fallback] ${label}: ${errPart}${ctxPart}`);

  try {
    getState().capture?.(label, err, ctx);
  } catch {
    // Telemetry must never throw — swallow.
  }
}

/**
 * Drop a breadcrumb (a low-signal event that becomes high-signal when
 * paired with a later exception). Use for retry attempts, idempotency
 * cache hits, rate-limit denies — things that aren't errors on their
 * own but tell a story when an error follows.
 */
export function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>
): void {
  try {
    getState().breadcrumb?.(category, message, data);
  } catch {
    // Swallow.
  }
}
