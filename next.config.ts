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
  // Don't fail the build if Sentry can't reach its servers during upload.
  errorHandler: (err) => {
    // eslint-disable-next-line no-console
    console.warn("[sentry] source-map upload failed (non-fatal):", err.message);
  },
});
