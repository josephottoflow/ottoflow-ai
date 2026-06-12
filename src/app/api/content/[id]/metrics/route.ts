/**
 * POST /api/content/[id]/metrics — Analytics Ingestion v1 (manual entry)
 *
 * Body: { impressions?, reach?, likes?, comments?, shares?, saves?, clicks? }
 * (all non-negative integers; at least one required)
 *
 * Writes a content_metrics SNAPSHOT (source='manual') for a PUBLISHED item.
 * engagement_rate = (likes+comments+shares+saves+clicks)/impressions, frozen
 * at write time. FUTURE COMPATIBILITY: platform API ingesters write the same
 * rows with source='linkedin_api'/'x_api'/… — this route is the manual twin
 * of that contract, not a special case.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { captureFallback } from "@/lib/observability";

export const runtime = "nodejs";

const metric = z.number().int().min(0).max(1_000_000_000).optional();
const MetricsSchema = z
  .object({
    impressions: metric,
    reach: metric,
    likes: metric,
    comments: metric,
    shares: metric,
    saves: metric,
    clicks: metric,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one metric",
  });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: itemId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = MetricsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Metrics must be non-negative whole numbers (at least one)." },
      { status: 400 },
    );
  }
  const m = parsed.data;

  const admin = createAdminClient();
  const { data: item, error: itemErr } = await admin
    .from("content_items")
    .select("id, status, brands!inner(user_id)")
    .eq("id", itemId)
    .single();
  if (itemErr || !item) {
    return NextResponse.json({ error: "Content not found" }, { status: 404 });
  }
  if ((item.brands as unknown as { user_id: string }).user_id !== userId) {
    return NextResponse.json({ error: "Content not found" }, { status: 404 });
  }
  if (item.status !== "published") {
    return NextResponse.json(
      { error: "Metrics can only be recorded for published items." },
      { status: 409 },
    );
  }

  const engagements =
    (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0) + (m.clicks ?? 0);
  const engagementRate =
    m.impressions && m.impressions > 0
      ? Number((engagements / m.impressions).toFixed(4))
      : null;

  const { data: snapshot, error: insErr } = await admin
    .from("content_metrics")
    .insert({
      content_item_id: itemId,
      source: "manual",
      impressions: m.impressions ?? null,
      reach: m.reach ?? null,
      likes: m.likes ?? null,
      comments: m.comments ?? null,
      shares: m.shares ?? null,
      saves: m.saves ?? null,
      clicks: m.clicks ?? null,
      engagement_rate: engagementRate,
    })
    .select("id, captured_at, engagement_rate")
    .single();
  if (insErr || !snapshot) {
    captureFallback("metrics.insert_failed", insErr, { itemId });
    return NextResponse.json({ error: "Failed to save metrics" }, { status: 500 });
  }
  return NextResponse.json({ snapshot });
}
