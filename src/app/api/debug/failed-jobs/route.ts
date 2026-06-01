/**
 * Read failed brand-research jobs straight from the DB.
 *
 * /api/debug/health surfaces a count from BullMQ (the queue's view), but
 * after a job hits `failed` BullMQ may evict it from active memory — the
 * authoritative record is `public.brand_research_jobs.status = 'failed'`
 * in Supabase, with the captured `error_message` + last `logs` entries.
 *
 * Auth-gated like the rest of /api/debug/*. Remove pre-public-beta along
 * with the other debug routes.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Pull all non-successful job records — failed AND anything stuck in
  // queued/running for context. Newest first so cause-and-effect is easy
  // to read. Joins the brand row so we know which company a failure hit.
  const { data, error } = await admin
    .from("brand_research_jobs")
    .select(
      `
      id,
      brand_id,
      status,
      current_step,
      progress,
      error_message,
      bull_job_id,
      started_at,
      completed_at,
      logs,
      brands ( name, website, user_id, status )
      `,
    )
    .neq("status", "done")
    .order("started_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Also return the completed total so the reader can sanity-check
  // against the BullMQ counters.
  const { count: completedCount } = await admin
    .from("brand_research_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "done");

  return NextResponse.json({
    completedTotal: completedCount ?? null,
    nonCompleted: data ?? [],
    nonCompletedCount: data?.length ?? 0,
  });
}
