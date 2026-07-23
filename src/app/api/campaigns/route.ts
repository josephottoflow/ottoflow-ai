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

// Campaign Workspace V1 — optional workspace metadata accepted on create.
const WorkspaceFields = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(4000).optional(),
  objective: z.string().max(2000).optional(),
  owner: z.string().max(200).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  status: z.string().max(40).optional(),
  target_audience: z.string().max(2000).optional(),
  channels: z.array(z.string().max(60)).max(50).optional(),
  tags: z.array(z.string().max(60)).max(50).optional(),
  primary_cta: z.string().max(300).optional(),
  success_metrics: z.string().max(4000).optional(),
  notes: z.string().max(8000).optional(),
  color: z.string().max(20).optional(),
  icon: z.string().max(60).optional(),
  start_date: z.string().max(30).optional(),
  end_date: z.string().max(30).optional(),
});

const CreateSchema = WorkspaceFields.extend({
  brandId: z.string().uuid(),
  prompt: z.string().min(4).max(2000),
  platform: z.string().min(2).max(40).optional(),
  // Backward compatible: absent → true → create + enqueue execution (the existing
  // flow). false → create a workspace container only (no execution).
  execute: z.boolean().optional(),
});

// Duplicate an existing campaign's WORKSPACE metadata (never its child assets /
// research — those stay with the original). Creates a fresh 'planning' campaign.
const DuplicateSchema = z.object({
  duplicateOf: z.string().uuid(),
  name: z.string().max(200).optional(),
});

const WORKSPACE_COPY_FIELDS = [
  "brand_id", "prompt", "platform", "description", "objective", "owner", "priority",
  "target_audience", "channels", "tags", "primary_cta", "success_metrics", "notes",
  "color", "icon", "start_date", "end_date",
] as const;

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

  const admin = createAdminClient();

  // ── Duplicate flow (Campaign Workspace V1) ────────────────────────────────
  if (body && typeof body === "object" && "duplicateOf" in body) {
    const dup = DuplicateSchema.safeParse(body);
    if (!dup.success) {
      return NextResponse.json({ error: "duplicateOf (uuid) is required" }, { status: 400 });
    }
    const { data: src } = await admin
      .from("campaigns")
      .select("*")
      .eq("id", dup.data.duplicateOf)
      .maybeSingle();
    if (!src || src.user_id !== userId) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    const copy: Record<string, unknown> = { user_id: userId, status: "planning", asset_count: 0 };
    for (const f of WORKSPACE_COPY_FIELDS) copy[f] = (src as Record<string, unknown>)[f];
    copy.name = dup.data.name ?? `${src.name ?? src.title ?? "Campaign"} (copy)`;
    const { data: cloned, error: cloneErr } = await admin
      .from("campaigns")
      .insert(copy)
      .select("*")
      .single();
    if (cloneErr || !cloned) {
      captureFallback("campaign.duplicate_failed", cloneErr, { src: dup.data.duplicateOf });
      return NextResponse.json({ error: "Failed to duplicate campaign" }, { status: 500 });
    }
    return NextResponse.json({ campaign: cloned }, { status: 201 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "brandId (uuid) and prompt are required" }, { status: 400 });
  }
  const { brandId, prompt, platform, execute, ...workspace } = parsed.data;

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
      status: workspace.status ?? "planning",
      asset_count: 0,
      // Optional workspace metadata (undefined keys are ignored by supabase-js).
      ...workspace,
    })
    .select("*")
    .single();
  if (insErr || !campaign) {
    captureFallback("campaign.insert_failed", insErr, { brandId });
    return NextResponse.json({ error: "Failed to create campaign" }, { status: 500 });
  }

  // Workspace container only — do not enqueue execution.
  if (execute === false) {
    return NextResponse.json({ campaign }, { status: 201 });
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
