/**
 * POST /api/creatives/[id]/regenerate — re-run image generation for a creative
 * (Brand Creative Orchestrator Phase C).
 *
 * Allowed from 'ready' or 'failed' (the brief is already approved — this is a
 * fresh roll of the background + composite, NOT a new brief). The approved
 * brief is unchanged, so the gate contract is preserved: we only ever generate
 * from a human-approved brief. A new Imagen seed (entropy() in the worker)
 * yields a visibly different background.
 *
 * To change the STRATEGY, reject the brief and compose a new one instead.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { captureFallback } from "@/lib/observability";
import { creativeGenerationQueue } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { captureVariation } from "@/lib/creative-variations";

export const runtime = "nodejs";

const REGENERATABLE = new Set(["ready", "failed"]);
const MAX_REGENS = 10; // hard cap on Imagen spend per creative

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: creativeId } = await params;

  const rl = await rateLimit({
    key: `POST:/api/creatives/[id]/regenerate:${userId}`,
    limit: 20,
    windowSeconds: 60 * 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many regenerations. Slow down.", retryAfterSeconds: rl.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const admin = createAdminClient();

  const { data: creative } = await admin
    .from("content_creatives")
    .select(
      "id, status, brand_id, content_item_id, image_url, background_url, background_source, creative_brief, regen_count, status_history, brands!inner(user_id)",
    )
    .eq("id", creativeId)
    .maybeSingle();
  const ownerId = (creative?.brands as unknown as { user_id: string } | null)?.user_id;
  if (!creative || ownerId !== userId) {
    return NextResponse.json({ error: "Creative not found" }, { status: 404 });
  }
  if (!REGENERATABLE.has(creative.status as string)) {
    return NextResponse.json(
      { error: `Can't regenerate a ${creative.status} creative — only ready or failed ones.` },
      { status: 409 },
    );
  }
  if ((creative.regen_count as number) >= MAX_REGENS) {
    return NextResponse.json(
      { error: `Regeneration limit reached (${MAX_REGENS}). Compose a new brief instead.` },
      { status: 409 },
    );
  }

  // Preserve the CURRENT image as a variation before this regenerate overwrites
  // content_creatives.image_url (Creative Studio — Proposal A). Idempotent +
  // best-effort; the generation pipeline itself is untouched.
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

  // Move back to 'approved' (a valid generation source) + bump the counter.
  // The worker flips approved → generating → ready, same as the first run.
  const now = new Date().toISOString();
  const history = Array.isArray(creative.status_history) ? creative.status_history : [];
  history.push({ from: creative.status, to: "approved", at: now, by: "user", note: "regenerate" });

  const { error: updErr } = await admin
    .from("content_creatives")
    .update({
      status: "approved",
      regen_count: (creative.regen_count as number) + 1,
      generation_error: null,
      status_history: history,
    })
    .eq("id", creativeId)
    .in("status", ["ready", "failed"]); // guard against a concurrent regen
  if (updErr) {
    captureFallback("creative.regenerate_update_failed", updErr, { creativeId });
    return NextResponse.json({ error: "Failed to queue regeneration" }, { status: 500 });
  }

  try {
    await creativeGenerationQueue().add(
      "generate",
      { creativeId, brandId: creative.brand_id as string, regen: true },
      // New jobId each regen so a removed-on-complete prior job doesn't clash.
      // BullMQ rejects custom job ids containing ':' — use hyphens.
      { jobId: `creative-${creativeId}-regen-${(creative.regen_count as number) + 1}` },
    );
  } catch (err) {
    captureFallback("creative.regenerate_enqueue_failed", err, { creativeId });
    await admin
      .from("content_creatives")
      .update({ status: creative.status as string })
      .eq("id", creativeId);
    return NextResponse.json({ error: "Couldn't start regeneration." }, { status: 500 });
  }

  const { data: updated } = await admin
    .from("content_creatives")
    .select("*")
    .eq("id", creativeId)
    .single();

  return NextResponse.json({ creative: updated });
}
