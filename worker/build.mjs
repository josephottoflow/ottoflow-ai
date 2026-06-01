/**
 * Worker production bundle.
 *
 * Bundles worker/index.ts plus every transitive import into a single
 * CommonJS file at worker/dist/index.js. Plain `node` runs the output —
 * no tsx, no tsconfig-paths, no transpile-on-startup. This is what
 * Railway runs in production.
 *
 *   npm run build:worker
 *   npm run start:worker     →   node worker/dist/index.js
 *
 * For local development, use `npm run dev:worker` which keeps tsx watch
 * mode for fast iteration.
 */
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const outdir = resolve(here, "dist");

// Clean previous output so we don't ship stale modules alongside fresh ones.
try {
  rmSync(outdir, { recursive: true, force: true });
} catch {
  // First run — nothing to clean.
}

const startedAt = Date.now();

await build({
  entryPoints: [resolve(here, "index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: resolve(outdir, "index.js"),
  sourcemap: "inline",
  // Inherits tsconfig "paths" → resolves @/* at build time so the bundle
  // has no path-alias requirements at runtime.
  tsconfig: resolve(projectRoot, "tsconfig.json"),
  // Externalize Sentry + OpenTelemetry. @sentry/node@10 depends on the
  // OpenTelemetry instrumentation registry, which loads instrumentations
  // dynamically via require() — esbuild can't statically bundle that.
  // node_modules is present at runtime on Railway (nixpacks runs
  // `npm ci --include=dev`), so a require('@sentry/node') from the
  // bundle resolves cleanly.
  external: [
    "@sentry/node",
    "@sentry/core",
    "@sentry/utils",
    "@opentelemetry/api",
    "@opentelemetry/core",
    "@opentelemetry/instrumentation",
    "@opentelemetry/resources",
    "@opentelemetry/sdk-trace-base",
    "@opentelemetry/sdk-trace-node",
    "@opentelemetry/semantic-conventions",
  ],
  // BullMQ's Lua scripts and JSON imports are handled by esbuild's
  // default loaders.
  loader: {
    ".lua": "text",
    ".json": "json",
  },
  // Minify off — keeps stack traces readable in Railway logs. Workers
  // are not cold-start sensitive so we trade a few hundred KB of size
  // for ops legibility.
  minify: false,
  logLevel: "info",
});

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
console.log(`✔ worker bundle written to worker/dist/index.js (${elapsed}s)`);
