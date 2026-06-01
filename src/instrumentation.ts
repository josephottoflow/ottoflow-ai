/**
 * Next.js instrumentation entry-point.
 *
 * Next calls `register()` once per worker process at startup, BEFORE any
 * request is handled. That's the right moment to install Sentry so we
 * capture failures during module init (env validation, DB client
 * construction, etc.) — not just runtime errors.
 *
 * Runtime-aware: Next.js runs both Node and Edge serverless contexts;
 * each needs its own Sentry config because the SDK feature surfaces
 * differ. We import the matching file dynamically so the Edge bundle
 * doesn't pull in Node-only code (and vice versa).
 *
 * `onRequestError` lets Next.js forward any uncaught server-side error
 * directly to Sentry with the full request context — this catches the
 * cases where our segment ErrorBoundary (app/error.tsx) is the last
 * line of defense.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
