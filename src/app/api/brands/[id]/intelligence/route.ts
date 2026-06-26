/**
 * GET /api/brands/[id]/intelligence — the brand's Creative Intelligence profile
 * (Brand Learning Engine, Sprint 22).
 *
 * Computed-on-read from the brand's DELIVERED creatives (no table, no migration):
 * best worlds/lighting/lens/..., overused/underused worlds, pass rate, diversity
 * and improvement trend. INTERNAL / operations only — owner-gated via RLS; never
 * surfaced to the customer.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { loadCreativeIntelligence } from "@/lib/creative/brand-intelligence";
import { loadPerformanceIntelligence } from "@/lib/creative/performance-intelligence";
import { captureFallback } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: brandId } = await params;

  try {
    const sb = await createServerSupabaseClient();
    // RLS scopes brands to the owner — a non-owned id returns no row → 404.
    const { data: brand } = await sb
      .from("brands")
      .select("id, industry")
      .eq("id", brandId)
      .maybeSingle();
    if (!brand) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }
    const [intelligence, performance] = await Promise.all([
      loadCreativeIntelligence(sb, brandId, brand.industry ?? null),
      loadPerformanceIntelligence(sb, brandId, brand.industry ?? null),
    ]);
    return NextResponse.json({ intelligence, performance });
  } catch (err) {
    captureFallback("brand.intelligence_failed", err, { brandId });
    return NextResponse.json({ error: "Failed to compute intelligence" }, { status: 500 });
  }
}
