/**
 * Sentry init for the Next.js Node runtime (RSC, API routes, server actions).
 *
 * Loaded from `src/instrumentation.ts` when NEXT_RUNTIME === "nodejs".
 *
 * No-DSN behavior: if SENTRY_DSN is missing, Sentry.init({ dsn: undefined })
 * makes the SDK a no-op — every captureException, addBreadcrumb, etc. is
 * silently dropped. That preserves today's "logs only" behavior until the
 * user pastes a DSN into Vercel env vars. No further code changes needed.
 *
 * What's instrumented:
 *   - Unhandled exceptions / promise rejections
 *   - HTTP / fetch tracing (low sample rate — 5% by default)
 *   - Defensive-layer fallbacks: bridged from @/lib/observability via
 *     setObservabilityHandlers below. Every `captureFallback()` call in
 *     gemini.ts / supabase-server.ts / db.ts / db-brands.ts is forwarded
 *     here with rich context.
 */
import * as Sentry from "@sentry/nextjs";
import { setObservabilityHandlers } from "@/lib/observability";

const dsn = process.env.SENTRY_DSN;
const env = process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development";

Sentry.init({
  dsn,
  environment: env,
  // Conservative tracing — bump later once we know error volume + cost.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.05),
  // Profiling off by default — adds CPU overhead.
  profilesSampleRate: 0,
  // Source-map upload happens via withSentryConfig in next.config.ts (no-op
  // without SENTRY_AUTH_TOKEN). Keep stack traces useful even without upload.
  attachStacktrace: true,
  // Tag every event so we can filter Next-server-side vs worker vs edge.
  initialScope: { tags: { runtime: "nextjs-node" } },
});

// Bridge: defensive-layer fallbacks → Sentry breadcrumbs + exceptions.
setObservabilityHandlers({
  capture: (label, err, ctx) => {
    Sentry.withScope((scope) => {
      scope.setTag("fallback.label", label);
      if (ctx) scope.setContext("fallback", ctx);
      // Strings get captured as messages; Errors keep their stack trace.
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
