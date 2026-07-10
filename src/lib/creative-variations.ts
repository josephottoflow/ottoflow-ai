/**
 * Creative variation history (Creative Studio — Proposal A, migration 032).
 *
 * A thin service over the `creative_variations` table. Variations are captured
 * at the API layer only — the generation pipeline / worker are NOT touched.
 * "Selected" is derived at read time (a variation's image_url === the parent
 * content_creatives.image_url), so restoring a version is a pointer swap with
 * no re-render.
 *
 * All writes run through the service-role admin client; callers authorize
 * ownership via Clerk before invoking these (same pattern as content_creatives).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbCreativeVariation } from "@/lib/types";

type Admin = SupabaseClient;

/** The subset of a content_creatives row needed to capture its current image. */
export interface CaptureSource {
  id: string;
  content_item_id: string;
  brand_id: string;
  image_url: string | null;
  background_url?: string | null;
  background_source?: string | null;
  creative_brief?: Record<string, unknown> | null;
  regen_count?: number | null;
}

/**
 * Idempotently record a creative's CURRENT image as a variation. No-op when the
 * creative has no image yet, or when this exact image is already recorded (the
 * unique constraint makes re-capture a no-op). Best-effort: never throws into
 * the caller's request path.
 */
export async function captureVariation(admin: Admin, src: CaptureSource): Promise<void> {
  if (!src.image_url) return;
  try {
    await admin.from("creative_variations").upsert(
      {
        creative_id: src.id,
        content_item_id: src.content_item_id,
        brand_id: src.brand_id,
        image_url: src.image_url,
        background_url: src.background_url ?? null,
        background_source: src.background_source ?? null,
        brief_snapshot: src.creative_brief ?? null,
        regen_index: src.regen_count ?? 0,
      },
      { onConflict: "creative_id,image_url", ignoreDuplicates: true },
    );
  } catch (err) {
    console.error("[creative-variations] capture failed (non-fatal):", err);
  }
}

/** List a creative's variations, newest first. */
export async function listVariations(
  admin: Admin,
  creativeId: string,
): Promise<DbCreativeVariation[]> {
  const { data } = await admin
    .from("creative_variations")
    .select("*")
    .eq("creative_id", creativeId)
    .order("created_at", { ascending: false });
  return (data ?? []) as DbCreativeVariation[];
}

/**
 * Restore a variation by pointing the parent content_creatives.image_url at it
 * (plus its background fields). Pure pointer swap — no regeneration, pipeline
 * untouched. Returns the restored image_url, or null if the variation does not
 * belong to this creative.
 */
export async function selectVariation(
  admin: Admin,
  creativeId: string,
  variationId: string,
): Promise<{ imageUrl: string } | null> {
  const { data: v } = await admin
    .from("creative_variations")
    .select("id, image_url, background_url, background_source")
    .eq("id", variationId)
    .eq("creative_id", creativeId)
    .maybeSingle();
  if (!v) return null;

  const variation = v as Pick<
    DbCreativeVariation,
    "image_url" | "background_url" | "background_source"
  >;
  const { error } = await admin
    .from("content_creatives")
    .update({
      image_url: variation.image_url,
      background_url: variation.background_url,
      background_source: variation.background_source,
    })
    .eq("id", creativeId);
  if (error) throw error;
  return { imageUrl: variation.image_url };
}
