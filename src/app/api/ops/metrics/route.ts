/**
 * GET /api/ops/metrics — internal AI operations metrics (Sprint 29).
 *
 * Admin-only. Aggregates the ai_usage_ledger over a window (default 30d) into
 * measured operational + billing-readiness metrics. Everything is computed from
 * recorded telemetry — no estimates beyond the central pricing table.
 *   ?days=30
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase";
import { getOpsMetrics } from "@/lib/ai-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    // 404 hides existence (same pattern as /api/debug/*).
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const daysRaw = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 365 ? daysRaw : 30;
  const metrics = await getOpsMetrics(createAdminClient(), days);
  return NextResponse.json({ metrics });
}
