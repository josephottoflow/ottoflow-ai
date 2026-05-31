/**
 * One-shot orphan-row cleanup. Auth-gated, uses admin client to delete
 * rows that RLS would otherwise prevent any signed-in user from removing
 * (because they don't own them).
 *
 * Hardcoded ID list — not a generic "delete any brand" endpoint. To clean
 * up new orphans later, edit ORPHAN_IDS and redeploy.
 *
 * GET to list what would be deleted (dry-run). POST to actually delete.
 * Remove this whole file pre-public-beta along with the other diagnostic
 * endpoints.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Known-orphan brand IDs (created under since-deleted Clerk users).
// Verified-orphan via /api/debug/rls-test before adding here.
const ORPHAN_IDS = [
  "a3f46feb-abf2-4a61-af31-17294b862d1f", // earliest smoke-test brand from a deleted Clerk user
  "f28c82ae-76c7-4125-9a9c-2e9353e383c9", // Linear, exhausted BullMQ retries before Gemini fix landed
];

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("brands")
    .select("id,user_id,name,status,created_at")
    .in("id", ORPHAN_IDS);

  return NextResponse.json({
    mode: "dry-run (use POST to actually delete)",
    candidateIds: ORPHAN_IDS,
    foundInDb: data ?? [],
    err: error?.message ?? null,
  });
}

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // 1. Snapshot what's about to be deleted (for audit)
  const { data: before } = await admin
    .from("brands")
    .select("id,user_id,name,status")
    .in("id", ORPHAN_IDS);

  // 2. Delete. Cascades to brand_research_jobs, competitors, keywords,
  //    content_pillars via ON DELETE CASCADE in 002_foundation.sql.
  const { error: delErr, count } = await admin
    .from("brands")
    .delete({ count: "exact" })
    .in("id", ORPHAN_IDS);

  if (delErr) {
    return NextResponse.json(
      { ok: false, error: delErr.message, attempted: ORPHAN_IDS },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    triggeredBy: userId,
    deletedCount: count ?? 0,
    deletedRows: before ?? [],
    note: "Related rows in brand_research_jobs/competitors/keywords/content_pillars cascade-deleted automatically.",
  });
}
