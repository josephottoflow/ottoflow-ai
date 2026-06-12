/**
 * POST /api/content/[id]/review — Review Queue approval actions (V2 Phase 2)
 *
 * Body: { action: "approve" | "reject" | "revise", note?: string }
 *
 * Transitions (from draft | in_review | approved | rejected):
 *   approve → approved   (reviewed_at set)
 *   reject  → rejected   (note recommended — the why)
 *   revise  → draft      (note REQUIRED — what to change; the item leaves
 *                         the queue and the note seeds the next edit)
 *
 * scheduled/published are NOT settable here — those transitions belong to
 * the future publisher, which builds on these states. Every transition
 * appends to status_history ([{from,to,at,by,note?}]) — the lifecycle audit
 * trail.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { captureFallback } from "@/lib/observability";

export const runtime = "nodejs";

const ReviewSchema = z.object({
  action: z.enum(["approve", "reject", "revise"]),
  note: z.string().max(1000).optional(),
});

const TARGET: Record<string, string> = {
  approve: "approved",
  reject: "rejected",
  revise: "draft",
};

// States a review action may act on. scheduled/published are immutable here.
const REVIEWABLE = new Set(["draft", "in_review", "approved", "rejected"]);

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
  const parsed = ReviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "action must be approve | reject | revise" },
      { status: 400 },
    );
  }
  const { action, note } = parsed.data;
  if (action === "revise" && !note?.trim()) {
    return NextResponse.json(
      { error: "Revision requests need a note — what should change?" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Ownership: item → brand → user (admin client bypasses RLS).
  const { data: item, error: itemErr } = await admin
    .from("content_items")
    .select("id, status, status_history, brand_id, brands!inner(user_id)")
    .eq("id", itemId)
    .single();
  if (itemErr || !item) {
    return NextResponse.json({ error: "Content not found" }, { status: 404 });
  }
  const ownerId = (item.brands as unknown as { user_id: string }).user_id;
  if (ownerId !== userId) {
    return NextResponse.json({ error: "Content not found" }, { status: 404 });
  }
  const fromStatus = item.status as string;
  if (!REVIEWABLE.has(fromStatus)) {
    return NextResponse.json(
      { error: `A ${fromStatus} item can't be reviewed.` },
      { status: 409 },
    );
  }

  const toStatus = TARGET[action];
  const now = new Date().toISOString();
  const history = Array.isArray(item.status_history) ? item.status_history : [];
  history.push({
    from: fromStatus,
    to: toStatus,
    at: now,
    by: "user",
    ...(note?.trim() ? { note: note.trim() } : {}),
  });

  const { data: updated, error: updErr } = await admin
    .from("content_items")
    .update({
      status: toStatus,
      review_note: note?.trim() || null,
      reviewed_at: now,
      status_history: history,
    })
    .eq("id", itemId)
    .select("id, status, review_note, reviewed_at")
    .single();
  if (updErr || !updated) {
    captureFallback("review.update_failed", updErr, { itemId, action });
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }

  return NextResponse.json({ item: updated });
}
