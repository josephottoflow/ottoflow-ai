/**
 * POST /api/creatives/[id]/review — the CREATIVE APPROVAL GATE
 * (Creative Orchestrator Phase B).
 *
 * Body: { action: "approve" | "reject", note?: string }
 *
 * Transitions (only from brief_ready — generation states are immutable here):
 *   approve → approved   (Phase C will also enqueue creative generation —
 *                         the ONLY path into 'generating'; Imagen spend
 *                         cannot happen on an unapproved brief)
 *   reject  → rejected   (note recommended; compose a fresh brief afterwards)
 *
 * Every transition appends to status_history, same audit-trail contract as
 * content_items.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { captureFallback } from "@/lib/observability";
import { creativeGenerationQueue } from "@/lib/queue";

export const runtime = "nodejs";

const ReviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().max(1000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: creativeId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = ReviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "action must be approve | reject" },
      { status: 400 },
    );
  }
  const { action, note } = parsed.data;

  const admin = createAdminClient();

  // Ownership: creative → brand → user.
  const { data: creative } = await admin
    .from("content_creatives")
    .select("id, status, status_history, brand_id, content_item_id, brands!inner(user_id)")
    .eq("id", creativeId)
    .maybeSingle();
  const ownerId = (creative?.brands as unknown as { user_id: string } | null)?.user_id;
  if (!creative || ownerId !== userId) {
    return NextResponse.json({ error: "Creative not found" }, { status: 404 });
  }
  if (creative.status !== "brief_ready") {
    return NextResponse.json(
      { error: `A ${creative.status} creative can't be reviewed — only briefs awaiting review can.` },
      { status: 409 },
    );
  }

  const toStatus = action === "approve" ? "approved" : "rejected";
  const now = new Date().toISOString();
  const history = Array.isArray(creative.status_history) ? creative.status_history : [];
  history.push({
    from: "brief_ready",
    to: toStatus,
    at: now,
    by: "user",
    ...(note?.trim() ? { note: note.trim() } : {}),
  });

  const { data: updated, error: updErr } = await admin
    .from("content_creatives")
    .update({ status: toStatus, status_history: history })
    .eq("id", creativeId)
    .eq("status", "brief_ready") // guard against concurrent double-review
    .select("*")
    .single();
  if (updErr || !updated) {
    captureFallback("creative.review_failed", updErr, { creativeId, action });
    return NextResponse.json({ error: "Failed to update creative" }, { status: 500 });
  }

  // Phase C: an approved brief enqueues image generation from this exact
  // spot — the ONLY path into the generation pipeline, so the gate contract
  // holds (no Imagen before a human approval). Rejection enqueues nothing.
  //
  // Approval is DECOUPLED from the render worker by design: the creative
  // strategy is the deliverable, image generation is a separate later step.
  // If the worker/Redis is offline (e.g. Railway paused) the enqueue fails —
  // we do NOT roll the gate back. The creative stays 'approved' (strategy
  // locked in), the failure is recorded on status_history as a deferral, and
  // the response flags generationDeferred so the UI can explain that the
  // image will be produced when the worker is available. Re-approval isn't
  // possible from 'approved'; generation is (re)started by the Phase C
  // regenerate path once the worker is back.
  if (action === "approve") {
    try {
      await creativeGenerationQueue().add(
        "generate",
        { creativeId, brandId: updated.brand_id as string },
        // BullMQ rejects custom job ids containing ':' — use hyphens.
        { jobId: `creative-${creativeId}` },
      );
    } catch (err) {
      captureFallback("creative.enqueue_deferred", err, { creativeId });
      const deferHistory = Array.isArray(updated.status_history)
        ? [...updated.status_history]
        : [];
      deferHistory.push({
        from: "approved",
        to: "approved",
        at: new Date().toISOString(),
        by: "system",
        note: "Image generation deferred — render worker unavailable at approval time.",
      });
      const { data: deferred } = await admin
        .from("content_creatives")
        .update({ status_history: deferHistory })
        .eq("id", creativeId)
        .select("*")
        .single();
      return NextResponse.json({
        creative: deferred ?? updated,
        generationDeferred: true,
      });
    }
  }

  return NextResponse.json({ creative: updated });
}
