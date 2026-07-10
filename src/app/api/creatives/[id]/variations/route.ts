/**
 * GET /api/creatives/[id]/variations — variation history for a creative
 * (Creative Studio — Proposal A).
 *
 * Lists every distinct rendered image captured for the creative (newest first)
 * so the UI can compare versions side by side. Capture-on-read: the creative's
 * CURRENT image is recorded here (idempotently) the moment the view is opened,
 * so opening the compare panel always reflects the latest render. No generation
 * pipeline / worker code is touched.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { captureFallback } from "@/lib/observability";
import { captureVariation, listVariations } from "@/lib/creative-variations";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: creativeId } = await params;

  const admin = createAdminClient();
  const { data: creative } = await admin
    .from("content_creatives")
    .select(
      "id, content_item_id, brand_id, image_url, background_url, background_source, creative_brief, regen_count, status, brands!inner(user_id)",
    )
    .eq("id", creativeId)
    .maybeSingle();
  const ownerId = (creative?.brands as unknown as { user_id: string } | null)?.user_id;
  if (!creative || ownerId !== userId) {
    return NextResponse.json({ error: "Creative not found" }, { status: 404 });
  }

  // Capture-on-read: record the current image so it is part of the history the
  // moment the user opens the variations / compare view. Idempotent + best-effort.
  if (creative.status === "ready") {
    await captureVariation(admin, {
      id: creative.id as string,
      content_item_id: creative.content_item_id as string,
      brand_id: creative.brand_id as string,
      image_url: creative.image_url as string | null,
      background_url: creative.background_url as string | null,
      background_source: creative.background_source as string | null,
      creative_brief: creative.creative_brief as Record<string, unknown> | null,
      regen_count: creative.regen_count as number | null,
    });
  }

  try {
    const variations = await listVariations(admin, creativeId);
    return NextResponse.json({
      variations,
      selectedImageUrl: (creative.image_url as string | null) ?? null,
    });
  } catch (err) {
    captureFallback("creative.variations_list_failed", err, { creativeId });
    return NextResponse.json({ error: "Failed to list variations" }, { status: 500 });
  }
}
