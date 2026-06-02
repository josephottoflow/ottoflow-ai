import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
};

/**
 * withSentryConfig wires the Sentry webpack plugin (source-map upload) and
 * the tunnel route (`/monitoring` bypasses ad-blockers that strip
 * sentry-io.* requests).
 *
 * No-op-friendly: if SENTRY_AUTH_TOKEN is missing the plugin skips
 * source-map upload silently. If org / project are missing, source-map
 * upload is skipped but everything else (auto-instrumentation, runtime
 * captures) still works. Local dev is unaffected.
 *
 * `silent` lets the build run clean in dev; for CI we surface logs.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Browser-side captures route through /monitoring → our origin → Sentry.
  // Defeats client-side ad-blockers that block sentry.io directly.
  tunnelRoute: "/monitoring",
  // Strip Sentry SDK logger statements from production bundles (~few KB).
  disableLogger: true,
  // ─── Source-map upload hardening ──────────────────────────────────────────
  // Without these, only the framework chunks are uploaded and the entire
  // /video/* + worker bundles stay minified in Sentry stack traces.
  //
  // widenClientFileUpload: include EVERY client chunk, not just app/_app/_document.
  // Trade: longer build (~30s extra) for sane stack traces in prod errors.
  widenClientFileUpload: true,
  // hideSourceMaps: keep generated .map files server-side only (uploaded to
  // Sentry, not exposed publicly via the static asset CDN). Prevents leaking
  // unminified app code to anyone who knows about /_next/static/chunks/*.map.
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
  // Don't fail the build if Sentry can't reach its servers during upload.
  // We don't want a Sentry hiccup to break a customer-facing deploy.
  errorHandler: (err) => {
    // eslint-disable-next-line no-console
    console.warn("[sentry] source-map upload failed (non-fatal):", err.message);
  },
});
