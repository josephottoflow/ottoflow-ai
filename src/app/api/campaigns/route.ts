/**
 * Campaign Execution Engine (Sprint 25).
 *
 *   GET  /api/campaigns          — list the user's campaigns (newest first)
 *   POST /api/campaigns          — create + execute a campaign from one request
 *
 * POST creates the campaign row ('planning') and enqueues a single
 * campaign-execution job. The worker plans the strategy, composes a brief per
 * package asset (cross-asset aware), inserts approved creatives and enqueues
 * each through the existing creative-generation pipeline. One request → a full
 * campaign, no per-asset generation by the user.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";
import { captureFallback } from "@/lib/observability";
import { campaignExecutionQueue } from "@/lib/queue";
import type { DbBrand } from "@/lib/types";

export const runtime = "nodejs";

const CreateSchema = z.object({
  brandId: z.string().uuid(),
  prompt: z.string().min(4).max(2000),
  platform: z.string().min(2).max(40).optional(),
});

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("campaigns")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    captureFallback("campaign.list_failed", error, { userId });
    return NextResponse.json({ error: "Failed to list campaigns" }, { status: 500 });
  }
  return NextResponse.json({ campaigns: data ?? [] });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Each campaign fans out into N briefs (Gemini) + N renders — cap creation.
  const rl = await rateLimit({ key: `POST:/api/campaigns:${userId}`, limit: 10, windowSeconds: 60 * 60 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many campaigns. Slow down.", retryAfterSeconds: rl.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "brandId (uuid) and prompt are required" }, { status: 400 });
  }
  const { brandId, prompt, platform } = parsed.data;

  const admin = createAdminClient();
  const { data: brand } = await admin
    .from("brands")
    .select("id, user_id, name")
    .eq("id", brandId)
    .maybeSingle();
  if (!brand || (brand as Pick<DbBrand, "user_id">).user_id !== userId) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  const { data: campaign, error: insErr } = await admin
    .from("campaigns")
    .insert({
      user_id: userId,
      brand_id: brandId,
      prompt,
      platform: platform ?? "linkedin",
      status: "planning",
      asset_count: 0,
    })
    .select("*")
    .single();
  if (insErr || !campaign) {
    captureFallback("campaign.insert_failed", insErr, { brandId });
    return NextResponse.json({ error: "Failed to create campaign" }, { status: 500 });
  }

  // Enqueue execution. If the worker/Redis is offline the campaign stays
  // 'planning' (resumable) — we don't roll back; the UI explains the deferral.
  try {
    await campaignExecutionQueue().add(
      "execute",
      { campaignId: campaign.id as string },
      { jobId: `campaign-${campaign.id}` },
    );
  } catch (err) {
    captureFallback("campaign.enqueue_deferred", err, { campaignId: campaign.id });
    return NextResponse.json({ campaign, executionDeferred: true }, { status: 201 });
  }

  return NextResponse.json({ campaign }, { status: 201 });
}
