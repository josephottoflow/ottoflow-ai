/**
 * DELETE /api/brands/[id]/assets/[assetId] — remove one brand asset
 * (Creative Orchestrator Phase A).
 *
 * Deletes the storage object first, then the row. Creatives composed before
 * the deletion keep their own rendered output — nothing re-reads the asset
 * after compositing, so deletion is safe at any time.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { captureFallback } from "@/lib/observability";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: brandId, assetId } = await params;

  const admin = createAdminClient();

  // Ownership: asset → brand → user (don't leak existence to non-owners).
  const { data: asset } = await admin
    .from("brand_assets")
    .select("id, brand_id, storage_path, brands!inner(user_id)")
    .eq("id", assetId)
    .eq("brand_id", brandId)
    .maybeSingle();
  const ownerId = (asset?.brands as unknown as { user_id: string } | null)?.user_id;
  if (!asset || ownerId !== userId) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const { error: rmErr } = await admin.storage
    .from("brand-assets")
    .remove([asset.storage_path as string]);
  if (rmErr) {
    // Log but continue — an orphaned storage object is preferable to a row
    // that points at a file the user believes is deleted.
    captureFallback("brand_assets.storage_remove_failed", rmErr, { assetId });
  }

  const { error: delErr } = await admin
    .from("brand_assets")
    .delete()
    .eq("id", assetId);
  if (delErr) {
    captureFallback("brand_assets.delete_failed", delErr, { assetId });
    return NextResponse.json({ error: "Failed to delete asset" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
