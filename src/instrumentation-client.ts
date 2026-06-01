/**
 * Sentry init for the browser (Next 15.3+ convention).
 *
 * Loaded automatically by Next.js bundler in client bundles. Captures
 * unhandled promise rejections, React render errors (when paired with
 * the existing app/error.tsx + app/global-error.tsx boundaries), and
 * any errors thrown inside `use client` components.
 *
 * No-DSN behavior: same as the server configs — if SENTRY_DSN is missing,
 * the SDK is a silent no-op. Adding NEXT_PUBLIC_SENTRY_DSN to Vercel is
 * the only step needed to activate.
 *
 * NEXT_PUBLIC_ prefix is required so Webpack inlines the value into the
 * client bundle at build time.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const env =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
  process.env.NEXT_PUBLIC_VERCEL_ENV ??
  "development";

Sentry.init({
  dsn,
  environment: env,
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  // No session replay yet — it ships ~70KB of extra JS and we want to
  // verify error volume first. Easy to add later by appending an
  // integrations array here.
  attachStacktrace: true,
  initialScope: { tags: { runtime: "nextjs-client" } },
});

// Next.js needs the router-transition hook re-exported from this file so
// it can wire up route-change tracing automatically.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
