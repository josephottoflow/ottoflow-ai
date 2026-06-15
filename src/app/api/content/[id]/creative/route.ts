/**
 * Creative composition + listing (Creative Orchestrator Phase B).
 *
 *   GET  /api/content/[id]/creative — list creatives for the item (newest first)
 *   POST /api/content/[id]/creative — compose a fresh Creative Brief
 *
 * POST runs the hierarchy engine + ONE Gemini structured call synchronously
 * (~5-15s, same pattern as /api/brands/[id]/ask) and inserts a
 * content_creatives row in 'brief_ready' — the Creative Approval Gate state.
 * NO image generation happens here: the gate exists so poor creative strategy
 * is caught before Imagen costs are incurred. Approval (and, in Phase C,
 * generation) goes through /api/creatives/[id]/review.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";
import { captureFallback } from "@/lib/observability";
import { composeCreativeBrief, BriefValidationError, type ComposeBriefInput } from "@/lib/creative/brief";
import type { DbBrand, DbBrandAsset } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90; // up to 2 concept calls + possible brand_led recompose

/** Load item + owning brand; returns null unless the caller owns it. */
async function ownedItem(itemId: string, userId: string) {
  const admin = createAdminClient();
  const { data: item } = await admin
    .from("content_items")
    .select("id, brand_id, platform, title, preview, body, status, topic_id, creative_branding")
    .eq("id", itemId)
    .maybeSingle();
  if (!item || !item.brand_id) return null;

  const { data: brand } = await admin
    .from("brands")
    .select("*")
    .eq("id", item.brand_id)
    .maybeSingle();
  if (!brand || (brand as DbBrand).user_id !== userId) return null;

  return { admin, item, brand: brand as DbBrand };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: itemId } = await params;

  const owned = await ownedItem(itemId, userId);
  if (!owned) {
    return NextResponse.json({ error: "Content not found" }, { status: 404 });
  }

  const { data: creatives, error } = await owned.admin
    .from("content_creatives")
    .select("*")
    .eq("content_item_id", itemId)
    .order("created_at", { ascending: false });
  if (error) {
    captureFallback("creative.list_failed", error, { itemId });
    return NextResponse.json({ error: "Failed to list creatives" }, { status: 500 });
  }
  return NextResponse.json({ creatives: creatives ?? [] });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: itemId } = await params;

  // Brief composition burns Gemini tokens — same hourly budget class as
  // content generation.
  const rl = await rateLimit({
    key: `POST:/api/content/[id]/creative:${userId}`,
    limit: 15,
    windowSeconds: 60 * 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many creative briefs. Slow down.", retryAfterSeconds: rl.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const owned = await ownedItem(itemId, userId);
  if (!owned) {
    return NextResponse.json({ error: "Content not found" }, { status: 404 });
  }
  const { admin, item, brand } = owned;

  if (!item.body) {
    return NextResponse.json(
      { error: "This post has no body yet — wait for generation to finish." },
      { status: 409 },
    );
  }

  // One live brief per item: a creative already in the gate or pipeline must
  // be resolved (rejected, or regenerated in Phase C) before composing anew.
  const { data: active } = await admin
    .from("content_creatives")
    .select("id, status")
    .eq("content_item_id", itemId)
    .in("status", ["brief_ready", "approved", "generating"])
    .limit(1);
  if (active && active.length > 0) {
    return NextResponse.json(
      {
        error: `A creative is already ${active[0].status === "brief_ready" ? "awaiting review" : "in progress"} for this post. Approve or reject it first.`,
      },
      { status: 409 },
    );
  }

  // Brand assets (descriptions only feed the model; bytes never leave storage).
  const { data: assets } = await admin
    .from("brand_assets")
    .select("*")
    .eq("brand_id", item.brand_id)
    .order("created_at", { ascending: false });

  // Optional source idea for opportunity alignment.
  let topic: {
    title: string;
    hook_angle: string | null;
    opportunity_kind: string | null;
    category: string | null;
  } | null = null;
  if (item.topic_id) {
    const { data: t } = await admin
      .from("brand_topics")
      .select("title, hook_angle, opportunity_kind, category")
      .eq("id", item.topic_id)
      .maybeSingle();
    if (t) {
      topic = {
        title: t.title as string,
        hook_angle: (t.hook_angle as string | null) ?? null,
        opportunity_kind: (t.opportunity_kind as string | null) ?? null,
        category: (t.category as string | null) ?? null,
      };
    }
  }

  try {
    const { brief, backgroundPromptReplaced } = await composeCreativeBrief({
      brand,
      assets: (assets ?? []) as DbBrandAsset[],
      content: {
        title: item.title as string,
        preview: (item.preview as string | null) ?? null,
        body: item.body as string,
        platform: item.platform as string,
      },
      topic,
      branding: (item.creative_branding as ComposeBriefInput["branding"]) ?? null,
    });

    if (backgroundPromptReplaced) {
      // Not an error — the deterministic fallback kicked in. Log for tuning.
      captureFallback(
        "creative.background_prompt_replaced",
        new Error("model background prompt failed safety validation twice"),
        { itemId, hierarchy: brief.hierarchy },
      );
    }

    const now = new Date().toISOString();
    const { data: creative, error: insErr } = await admin
      .from("content_creatives")
      .insert({
        content_item_id: itemId,
        brand_id: item.brand_id,
        status: "brief_ready",
        creative_brief: brief,
        creative_hierarchy: brief.hierarchy,
        creative_confidence: brief.confidence,
        visual_tension: brief.visual_tension || null,
        visual_metaphor: brief.visual_metaphor || null,
        platform: brief.platform,
        status_history: [{ from: null, to: "brief_ready", at: now, by: "system" }],
      })
      .select("*")
      .single();
    if (insErr || !creative) {
      captureFallback("creative.insert_failed", insErr, { itemId });
      return NextResponse.json({ error: "Failed to save creative brief" }, { status: 500 });
    }

    return NextResponse.json({ creative }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    captureFallback("creative.compose_failed", err, { itemId });
    const status = err instanceof BriefValidationError ? 422 : 500;
    return NextResponse.json(
      { error: `Brief composition failed: ${message}` },
      { status },
    );
  }
}
