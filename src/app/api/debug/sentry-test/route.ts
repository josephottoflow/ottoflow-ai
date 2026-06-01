/**
 * Sentry activation probe.
 *
 * Purpose: once SENTRY_DSN is set in Vercel (and NEXT_PUBLIC_SENTRY_DSN for
 * the client bundle), hitting this endpoint should produce a visible event
 * in the Sentry dashboard within ~10 seconds. If it doesn't, the DSN is
 * wrong, the environment scope is wrong, or the redeploy didn't pick up the
 * new env var.
 *
 * What it does:
 *   1. Reports whether the observability shim has a handler registered
 *      (`isObservabilityWired()`). False = no Sentry-side init ran, which
 *      almost always means SENTRY_DSN is missing on this runtime.
 *   2. Drops a breadcrumb (`sentry.activation.test` / "probe fired") so the
 *      crumb appears attached to the exception below — proves both code
 *      paths reach Sentry.
 *   3. Calls `captureFallback("sentry.activation.test", new Error(...))`,
 *      which the bridge in sentry.server.config.ts forwards to
 *      Sentry.captureException with stable tag `fallback.label`.
 *
 * Side-effect-free: no DB writes, no Gemini calls, no queue inserts. Safe
 * to hit repeatedly.
 *
 * Auth-gated to match the rest of /api/debug/*. Remove pre-public-beta
 * along with the other debug routes.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  captureFallback,
  addBreadcrumb,
  isObservabilityWired,
} from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const wired = isObservabilityWired();
  const firedAt = new Date().toISOString();

  // Breadcrumb first so it gets attached to the exception below.
  addBreadcrumb("sentry.activation.test", "probe fired", {
    userId,
    firedAt,
  });

  // Stable label `sentry.activation.test` → easy to filter/group in Sentry.
  captureFallback(
    "sentry.activation.test",
    new Error("Sentry activation probe — safe to ignore"),
    {
      userId,
      firedAt,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      sentryEnv: process.env.SENTRY_ENVIRONMENT ?? null,
      runtime: "nextjs-node",
    },
  );

  return NextResponse.json({
    ok: true,
    wired,
    firedAt,
    expectedTag: "fallback.label = sentry.activation.test",
    nextStep: wired
      ? "Check Sentry → Issues — event should appear within ~10s."
      : "Observability NOT wired: SENTRY_DSN missing on this runtime. Set it in Vercel and redeploy.",
  });
}
