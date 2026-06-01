/**
 * Sentry init for the Next.js Edge runtime (middleware, edge route handlers).
 *
 * Loaded from `src/instrumentation.ts` when NEXT_RUNTIME === "edge".
 *
 * The Edge runtime forbids most Node APIs, so we keep this init minimal —
 * no profiling, no advanced integrations. Errors still capture with stack
 * traces.
 *
 * Clerk's middleware runs in the Edge runtime, so this catches auth-time
 * surprises (jwks fetch failures, etc.).
 */
import * as Sentry from "@sentry/nextjs";
import { setObservabilityHandlers } from "@/lib/observability";

const dsn = process.env.SENTRY_DSN;
const env = process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development";

Sentry.init({
  dsn,
  environment: env,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  attachStacktrace: true,
  initialScope: { tags: { runtime: "nextjs-edge" } },
});

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
