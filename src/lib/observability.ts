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
 *                   `sentry.client.config.ts` register `@sentry/nextjs`.
 *        - Worker:  `worker/observability.ts` registers `@sentry/node`.
 *     Until then, every call is a pure console log — preserving today's
 *     behavior. Adding SENTRY_DSN to env is the only switch needed.
 *   - Console logging is preserved even when Sentry is wired, so Vercel
 *     and Railway runtime logs still surface the same lines they do today.
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

let captureHandler: CaptureHandler | null = null;
let breadcrumbHandler: BreadcrumbHandler | null = null;

export function setObservabilityHandlers(handlers: {
  capture?: CaptureHandler;
  breadcrumb?: BreadcrumbHandler;
}): void {
  if (handlers.capture) captureHandler = handlers.capture;
  if (handlers.breadcrumb) breadcrumbHandler = handlers.breadcrumb;
}

/** True once a telemetry backend has registered. Useful for health probes. */
export function isObservabilityWired(): boolean {
  return captureHandler !== null;
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
    captureHandler?.(label, err, ctx);
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
    breadcrumbHandler?.(category, message, data);
  } catch {
    // Swallow.
  }
}
