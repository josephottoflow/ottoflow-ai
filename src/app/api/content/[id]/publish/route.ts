/**
 * POST /api/content/[id]/publish — Publisher Foundation v1 (V2 Phase 2)
 *
 * Body:
 *   { action: "schedule",       scheduledFor: ISO datetime }   approved  → scheduled
 *   { action: "unschedule" }                                   scheduled → approved
 *   { action: "mark_published", publishedUrl?: string }        approved | scheduled → published
 *
 * v1 is manual-only: mark_published records publishing_method='manual' with
 * platform_post_id NULL. FUTURE COMPATIBILITY CONTRACT: an API publisher
 * (LinkedIn/X/Facebook) executes the SAME transition — published_at,
 * published_url, platform_post_id, publishing_method='<platform>_api' — via
 * this table shape; only the actor changes (by:'system' in status_history).
 *
 * published is terminal in v1 (no unpublish). Every transition appends to
 * the status_history audit trail introduced in migration 014.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { captureFallback } from "@/lib/observability";

export const runtime = "nodejs";

const PublishSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("schedule"),
    scheduledFor: z.string().datetime({ offset: true }),
  }),
  z.object({ action: z.literal("unschedule") }),
  z.object({
    action: z.literal("mark_published"),
    publishedUrl: z.string().url().max(500).optional(),
  }),
]);

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
  const parsed = PublishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "action must be schedule | unschedule | mark_published" },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const admin = createAdminClient();
  const { data: item, error: itemErr } = await admin
    .from("content_items")
    .select("id, status, status_history, brands!inner(user_id)")
    .eq("id", itemId)
    .single();
  if (itemErr || !item) {
    return NextResponse.json({ error: "Content not found" }, { status: 404 });
  }
  if ((item.brands as unknown as { user_id: string }).user_id !== userId) {
    return NextResponse.json({ error: "Content not found" }, { status: 404 });
  }
  const fromStatus = item.status as string;

  // Transition table — the single source of truth future publishers reuse.
  const now = new Date();
  let toStatus: string;
  let patch: Record<string, unknown>;

  if (input.action === "schedule") {
    if (fromStatus !== "approved") {
      return NextResponse.json(
        { error: `Only approved items can be scheduled (this one is ${fromStatus}).` },
        { status: 409 },
      );
    }
    const when = new Date(input.scheduledFor);
    if (when.getTime() < now.getTime() - 60_000) {
      return NextResponse.json(
        { error: "Scheduled time must be in the future." },
        { status: 400 },
      );
    }
    toStatus = "scheduled";
    patch = { scheduled_for: when.toISOString() };
  } else if (input.action === "unschedule") {
    if (fromStatus !== "scheduled") {
      return NextResponse.json(
        { error: `Only scheduled items can be unscheduled (this one is ${fromStatus}).` },
        { status: 409 },
      );
    }
    toStatus = "approved";
    patch = { scheduled_for: null };
  } else {
    if (fromStatus !== "approved" && fromStatus !== "scheduled") {
      return NextResponse.json(
        { error: `Only approved or scheduled items can be published (this one is ${fromStatus}).` },
        { status: 409 },
      );
    }
    toStatus = "published";
    patch = {
      published_at: now.toISOString(),
      published_url: input.publishedUrl ?? null,
      platform_post_id: null,
      publishing_method: "manual",
    };
  }

  const history = Array.isArray(item.status_history) ? item.status_history : [];
  history.push({
    from: fromStatus,
    to: toStatus,
    at: now.toISOString(),
    by: "user",
    ...(input.action === "schedule" ? { note: `scheduled for ${patch.scheduled_for}` } : {}),
    ...(input.action === "mark_published" ? { note: "published manually" } : {}),
  });

  const { data: updated, error: updErr } = await admin
    .from("content_items")
    .update({ status: toStatus, status_history: history, ...patch })
    .eq("id", itemId)
    .select("id, status, scheduled_for, published_at, published_url, publishing_method")
    .single();
  if (updErr || !updated) {
    captureFallback("publish.update_failed", updErr, { itemId, action: input.action });
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }
  return NextResponse.json({ item: updated });
}
