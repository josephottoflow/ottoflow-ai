/**
 * PATCH /api/brands/[id]/colors — set the brand's manual color palette
 * (Creative Quality Phase 0B).
 *
 * Body: { primary?, secondary?, accent?, neutral? } — hex strings. Each is
 * validated + normalized to #rrggbb; invalid values are rejected. Stored on
 * brands.brand_colors with source="manual". Consumed by composeCreativeBrief
 * (paletteFromBrand) → Imagen prompt + sharp compositor (scrim + CTA + accent).
 *
 * No new tables, no new queues — reuses the existing brands.brand_colors jsonb.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { captureFallback } from "@/lib/observability";

export const runtime = "nodejs";

const KEYS = ["primary", "secondary", "accent", "neutral"] as const;

/** Normalize to #rrggbb (lowercase); null if not a valid hex color. */
function normHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let h = v.trim();
  if (!h) return null;
  if (!h.startsWith("#")) h = `#${h}`;
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    h = `#${h.slice(1).split("").map((c) => c + c).join("")}`;
  }
  return /^#[0-9a-fA-F]{6}$/.test(h) ? h.toLowerCase() : null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: brandId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const colors: Record<string, string> = {};
  for (const k of KEYS) {
    const raw = body[k];
    if (raw == null || raw === "") continue; // omitted = unset for that role
    const n = normHex(raw);
    if (n === null) {
      return NextResponse.json(
        { error: `${k} must be a valid hex color (e.g. #1a73e8)` },
        { status: 400 },
      );
    }
    colors[k] = n;
  }
  colors.source = "manual";

  const admin = createAdminClient();
  const { data: brand } = await admin
    .from("brands")
    .select("id, user_id")
    .eq("id", brandId)
    .maybeSingle();
  if (!brand || brand.user_id !== userId) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  const { data: updated, error } = await admin
    .from("brands")
    .update({ brand_colors: colors })
    .eq("id", brandId)
    .select("brand_colors")
    .single();
  if (error || !updated) {
    captureFallback("brand_colors.update_failed", error, { brandId });
    return NextResponse.json({ error: "Failed to save colors" }, { status: 500 });
  }

  return NextResponse.json({ brand_colors: updated.brand_colors });
}
