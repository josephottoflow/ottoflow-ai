/**
 * POST /api/creatives/[id]/variations/[vid]/select — restore a previous version
 * (Creative Studio — Proposal A).
 *
 * Points the creative's image_url (and background fields) at a previously
 * captured variation. Pure pointer swap on content_creatives — NO regeneration,
 * NO Imagen spend, generation pipeline untouched.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { captureFallback } from "@/lib/observability";
import { selectVariation } from "@/lib/creative-variations";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; vid: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: creativeId, vid: variationId } = await params;

  const admin = createAdminClient();
  const { data: creative } = await admin
    .from("content_creatives")
    .select("id, status, brands!inner(user_id)")
    .eq("id", creativeId)
    .maybeSingle();
  const ownerId = (creative?.brands as unknown as { user_id: string } | null)?.user_id;
  if (!creative || ownerId !== userId) {
    return NextResponse.json({ error: "Creative not found" }, { status: 404 });
  }
  if (creative.status !== "ready") {
    return NextResponse.json(
      { error: `Can't restore a version on a ${creative.status} creative — only ready ones.` },
      { status: 409 },
    );
  }

  try {
    const res = await selectVariation(admin, creativeId, variationId);
    if (!res) {
      return NextResponse.json({ error: "Variation not found" }, { status: 404 });
    }
    const { data: updated } = await admin
      .from("content_creatives")
      .select("*")
      .eq("id", creativeId)
      .single();
    return NextResponse.json({ creative: updated, imageUrl: res.imageUrl });
  } catch (err) {
    captureFallback("creative.variation_select_failed", err, { creativeId, variationId });
    return NextResponse.json({ error: "Failed to restore version" }, { status: 500 });
  }
}
