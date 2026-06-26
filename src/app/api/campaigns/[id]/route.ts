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
import { createAdminClient } from "@/lib/supabase";
import { captureFallback } from "@/lib/observability";
import {
  computeCampaignQA,
  computeProgress,
  type AssetView,
} from "@/lib/creative/campaign-execution";
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

  return NextResponse.json({ campaign: { ...campaign, status }, assets, progress, qa });
}
