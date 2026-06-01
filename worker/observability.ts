/**
 * Worker-side Sentry init.
 *
 * Imported by worker/index.ts very early (after dotenv but before BullMQ /
 * processor imports) so that any errors during boot — including env
 * validation failures and Redis connect failures — get reported.
 *
 * Uses @sentry/node (not @sentry/nextjs) so the worker's esbuild bundle
 * stays free of Next.js-specific code.
 *
 * No-DSN behavior: Sentry.init({ dsn: undefined }) is a no-op. The console
 * logging in src/lib/observability.ts still runs, preserving today's
 * behavior in Railway logs.
 */
import * as Sentry from "@sentry/node";
import { setObservabilityHandlers } from "@/lib/observability";

const dsn = process.env.SENTRY_DSN;
const env =
  process.env.SENTRY_ENVIRONMENT ??
  process.env.RAILWAY_ENVIRONMENT ??
  "development";

Sentry.init({
  dsn,
  environment: env,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  profilesSampleRate: 0,
  attachStacktrace: true,
  initialScope: { tags: { runtime: "worker" } },
});

// Bridge the shared observability shim → Sentry.
setObservabilityHandlers({
  capture: (label, err, ctx) => {
    Sentry.withScope((scope) => {
      scope.setTag("fallback.label", label);
      if (ctx) scope.setContext("fallback", ctx);
      if (err instanceof Error) {
        Sentry.captureException(err);
      } else {
        Sentry.captureMessage(`[fallback] ${label}: ${String(err)}`, "warning");
      }
    });
  },
  breadcrumb: (category, message, data) => {
    Sentry.addBreadcrumb({ category, message, data, level: "info" });
  },
});

/**
 * Exported helpers for the worker process to use directly (alongside the
 * captureFallback shim). Useful for the explicit catch-all handlers in
 * worker/index.ts where we want the raw stack trace, not a fallback label.
 */
export { Sentry };

/**
 * Best-effort flush before exit. Sentry batches events; if we exit
 * immediately on SIGTERM/uncaughtException the queue gets dropped.
 * Returns a promise so the caller can await before process.exit().
 */
export async function flushSentry(timeoutMs = 2_000): Promise<void> {
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // Never throw from flush — we're already on the way out.
  }
}
