/**
 * Sentry activation probe.
 *
 * Diagnoses Sentry wiring at three levels and surfaces what's broken in
 * the JSON response so we don't need server logs to triage:
 *
 *   1. SDK client live? — `Sentry.getClient()` returns the registered
 *      client. If undefined, the SDK never initialized on this runtime
 *      (config wasn't imported by the instrumentation hook).
 *
 *   2. Shim handler registered? — `isObservabilityWired()` reports
 *      whether `setObservabilityHandlers()` was called. False here while
 *      (1) is true means the shim's module-level state didn't survive
 *      bundling — different routes ended up with separate copies of the
 *      observability module, so the handler registered in one bundle
 *      isn't visible from this route's bundle.
 *
 *   3. End-to-end event reaches Sentry? — we fire BOTH a direct
 *      `Sentry.captureException` AND a `captureFallback()` via the shim.
 *      If the direct one shows up in Sentry but the shim one doesn't,
 *      that's the singleton bug. If neither shows, the SDK isn't live.
 *
 * Always flushes before responding so events ship before the serverless
 * function freezes.
 *
 * Side-effect-free: no DB writes, no Gemini calls, no queue inserts.
 * Auth-gated. Remove pre-public-beta with the other debug routes.
 */
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  captureFallback,
  addBreadcrumb,
  isObservabilityWired,
} from "@/lib/observability";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // B1.R8 — admin-only. 404 hides existence.
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const userId = adminId;

  const firedAt = new Date().toISOString();

  // ── Level 1: is the SDK client registered on this runtime? ───────────
  const client = Sentry.getClient();
  const sdkActive = !!client;
  const sdkDsn = client?.getDsn();
  const sdkOptions = client?.getOptions();

  // ── Level 2: is our shim's handler wired? ───────────────────────────
  const shimWired = isObservabilityWired();

  // ── Level 3: end-to-end — fire BOTH paths so we can compare in Sentry ──
  addBreadcrumb("sentry.activation.test", "probe fired (shim path)", {
    userId,
    firedAt,
  });
  captureFallback(
    "sentry.activation.test",
    new Error("Sentry activation probe — shim path"),
    { userId, firedAt, path: "shim", runtime: "nextjs-node" },
  );

  let directEventId: string | undefined;
  try {
    directEventId = Sentry.captureException(
      new Error("Sentry activation probe — direct path"),
      {
        tags: {
          "fallback.label": "sentry.activation.test.direct",
          runtime: "nextjs-node",
        },
        extra: { userId, firedAt, path: "direct" },
      },
    );
  } catch (err) {
    directEventId = `threw: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Drain Sentry's queue before the function freezes — without this,
  // events get dropped on cold-path invocations.
  let flushed = false;
  try {
    flushed = await Sentry.flush(2_000);
  } catch {
    flushed = false;
  }

  // Diagnosis from the four bits
  let diagnosis: string;
  if (sdkActive && shimWired) {
    diagnosis = "OK — SDK live and shim wired. Both events should appear in Sentry within ~10s.";
  } else if (sdkActive && !shimWired) {
    diagnosis =
      "SDK is live but the shim is NOT wired in this route's bundle (ES-module singleton issue). " +
      "Direct captures will reach Sentry; shim captures (gemini retries, db safe() wrappers, etc.) " +
      "will silently drop. Fix: move handler state onto globalThis in src/lib/observability.ts.";
  } else if (!sdkActive && shimWired) {
    diagnosis = "Impossible state — investigate. Shim was set but SDK client is missing.";
  } else {
    diagnosis =
      "SDK not initialized on this runtime. Check that src/instrumentation.ts ran and " +
      "imported sentry.server.config.ts. Verify SENTRY_DSN is set on Production scope.";
  }

  return NextResponse.json({
    ok: true,
    firedAt,
    sdk: {
      active: sdkActive,
      dsnHost: sdkDsn?.host ?? null,
      environment: sdkOptions?.environment ?? null,
      release: sdkOptions?.release ?? null,
    },
    shim: {
      wired: shimWired,
    },
    events: {
      direct: directEventId ?? null,
      flushed,
    },
    expected: {
      directTag: "fallback.label = sentry.activation.test.direct",
      shimTag: "fallback.label = sentry.activation.test",
    },
    diagnosis,
  });
}
