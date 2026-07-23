/**
 * GET /api/campaigns/[id] — campaign detail + live progress + Campaign QA.
 *
 * Progress + QA are computed on read from the current asset states (the
 * campaign-execution job doesn't block on every render), so the customer sees
 * "N of M assets complete" and the campaign self-promotes generating → review →
 * ready as its assets finish. Owner-gated via campaigns.user_id.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { captureFallback } from "@/lib/observability";
import {
  computeCampaignQA,
  computeProgress,
  type AssetView,
} from "@/lib/creative/campaign-execution";
import { getCampaignMetrics } from "@/lib/db-campaigns";
import type { CampaignStrategy } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!campaign || campaign.user_id !== userId) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const { data: creatives } = await admin
    .from("content_creatives")
    .select("id, campaign_role, status, image_url, creative_brief, created_at")
    .eq("campaign_id", id)
    .order("created_at", { ascending: true });

  const rows = creatives ?? [];
  const assets = rows.map((c) => {
    const brief = (c.creative_brief ?? {}) as {
      headline?: string;
      cta?: string;
      creative_direction?: { world?: string };
      campaign?: { funnel_position?: string };
    };
    return {
      id: c.id as string,
      role: (c.campaign_role as string | null) ?? "",
      status: c.status as string,
      image_url: (c.image_url as string | null) ?? null,
      headline: brief.headline ?? "",
      cta: brief.cta ?? "",
      world: brief.creative_direction?.world ?? "",
      funnel_position: brief.campaign?.funnel_position ?? "",
    };
  });

  const assetViews: AssetView[] = assets.map((a) => ({
    role: a.role,
    status: a.status,
    headline: a.headline,
    cta: a.cta,
    world: a.world,
    funnel_position: a.funnel_position,
  }));

  const progress = computeProgress(assetViews);
  const qa = computeCampaignQA(assetViews, (campaign.strategy as CampaignStrategy | null) ?? null);
  // Campaign Workspace V1 — live workspace metrics rolled up from relationships
  // (research ideas / content / creatives by campaign_id). Additive to the response.
  const metrics = await getCampaignMetrics(admin, id).catch(() => null);

  // Self-promote the campaign status as assets finish (best-effort).
  let status = campaign.status as string;
  if (progress.total > 0 && status === "generating" && progress.done) {
    status = progress.failed === progress.total ? "failed" : "ready";
    try {
      await admin
        .from("campaigns")
        .update({ status, qa, updated_at: new Date().toISOString() })
        .eq("id", id);
    } catch (err) {
      captureFallback("campaign.status_update_failed", err, { campaignId: id });
    }
  }

  return NextResponse.json({ campaign: { ...campaign, status }, assets, progress, qa, metrics });
}

// ─── PATCH /api/campaigns/[id] — update workspace fields (Campaign Workspace V1) ──
// Owner-gated, additive. Updates only the workspace metadata; never touches
// strategy/qa/asset_count (those are owned by the execution engine). Archive and
// favorite are just field updates. Absent fields are left unchanged.
const PatchSchema = z
  .object({
    name: z.string().max(200).nullable().optional(),
    title: z.string().max(300).nullable().optional(),
    description: z.string().max(4000).nullable().optional(),
    objective: z.string().max(2000).nullable().optional(),
    owner: z.string().max(200).nullable().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    status: z.string().max(40).optional(),
    target_audience: z.string().max(2000).nullable().optional(),
    channels: z.array(z.string().max(60)).max(50).optional(),
    tags: z.array(z.string().max(60)).max(50).optional(),
    primary_cta: z.string().max(300).nullable().optional(),
    success_metrics: z.string().max(4000).nullable().optional(),
    notes: z.string().max(8000).nullable().optional(),
    color: z.string().max(20).nullable().optional(),
    icon: z.string().max(60).nullable().optional(),
    is_favorite: z.boolean().optional(),
    is_archived: z.boolean().optional(),
    start_date: z.string().max(30).nullable().optional(),
    end_date: z.string().max(30).nullable().optional(),
  })
  .strict();

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid campaign fields" }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("campaigns")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.user_id !== userId) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const { data, error } = await admin
    .from("campaigns")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    captureFallback("campaign.update_failed", error, { campaignId: id });
    return NextResponse.json({ error: "Failed to update campaign" }, { status: 500 });
  }
  return NextResponse.json({ campaign: data });
}
