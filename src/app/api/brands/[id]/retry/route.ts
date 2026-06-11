import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { brandResearchQueue } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { captureFallback } from "@/lib/observability";

/**
 * Re-run brand research for a failed (or stuck) brand.
 *
 * Why this exists: Gemini occasionally returns 503 ("model overloaded"),
 * which our worker correctly captures and surfaces. Without a retry path,
 * the user's only recovery is "delete the brand and re-submit" — which
 * loses any partial data already extracted before the failure point.
 * This endpoint resets the job row in place and re-enqueues BullMQ.
 *
 * Guards:
 *   - Caller must own the brand (user_id == clerk userId)
 *   - Cannot retry a brand that's currently `researching` (avoids dup jobs)
 *   - Rate-limited via the same bucket as POST /api/brands (no escape hatch)
 */
export const runtime = "nodejs";

const RATE_LIMIT = { limit: 10, windowSeconds: 60 * 60 } as const; // shared with create
const ROUTE = "POST:/api/brands/[id]/retry";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: brandId } = await params;
  if (!brandId) {
    return NextResponse.json({ error: "Missing brand id" }, { status: 400 });
  }

  // Same rate-limit bucket as create — a malicious caller can't escape the
  // per-hour cap by alternating create/retry.
  const rl = await rateLimit({
    key: `POST:/api/brands:${userId}`, // intentionally shared
    limit: RATE_LIMIT.limit,
    windowSeconds: RATE_LIMIT.windowSeconds,
  });
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "Too many brand operations. Slow down.",
        retryAfterSeconds: rl.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      },
    );
  }

  const admin = createAdminClient();

  // Fetch brand + own job to validate ownership and current state.
  const { data: brand, error: brandErr } = await admin
    .from("brands")
    .select("id, user_id, name, website, industry, status")
    .eq("id", brandId)
    .single();

  if (brandErr || !brand) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }
  if (brand.user_id !== userId) {
    // Don't leak existence to non-owners — same 404 as missing.
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }
  if (brand.status === "researching") {
    return NextResponse.json(
      { error: "Research is already in progress for this brand." },
      { status: 409 },
    );
  }

  // Find the latest job row for this brand to reset in-place. Preserves the
  // log history and bull_job_id continuity — easier to debug than spawning a
  // new job each retry.
  const { data: job, error: jobFetchErr } = await admin
    .from("brand_research_jobs")
    .select("id")
    .eq("brand_id", brandId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (jobFetchErr) {
    return NextResponse.json({ error: jobFetchErr.message }, { status: 500 });
  }

  let researchJobId: string;
  if (job) {
    // Reset existing row
    const { data: updated, error: updErr } = await admin
      .from("brand_research_jobs")
      .update({
        status: "queued",
        current_step: "queued",
        progress: 0,
        error_message: null,
        completed_at: null,
        // logs intentionally preserved — history matters
      })
      .eq("id", job.id)
      .select("id")
      .single();
    if (updErr || !updated) {
      return NextResponse.json(
        { error: updErr?.message ?? "Failed to reset research job" },
        { status: 500 },
      );
    }
    researchJobId = updated.id;
  } else {
    // No prior job row (shouldn't normally happen, but be defensive)
    const { data: created, error: insErr } = await admin
      .from("brand_research_jobs")
      .insert({
        brand_id: brandId,
        status: "queued",
        current_step: "queued",
        progress: 0,
      })
      .select("id")
      .single();
    if (insErr || !created) {
      return NextResponse.json(
        { error: insErr?.message ?? "Failed to create research job" },
        { status: 500 },
      );
    }
    researchJobId = created.id;
  }

  // Flip brand status so the UI immediately switches out of the failure card
  // before Realtime even fires.
  await admin
    .from("brands")
    .update({ status: "pending" })
    .eq("id", brandId);

  // Enqueue. If this throws we leave the job row in queued state so a stuck
  // job sweep / manual retry can pick it up.
  try {
    const queue = brandResearchQueue();

    // Remove any existing BullMQ job with the same id. BullMQ dedupes by
    // jobId — calling queue.add() with an id that already exists in any
    // of the completed/failed/waiting sets returns the existing job
    // (no new run). Without this remove() the worker would silently
    // skip the retry. Verified by repro: the first retry of the Linear
    // brand reset the DB row to queued but the worker never picked up
    // the BullMQ side. queue.remove() is idempotent — safe if no job.
    try {
      await queue.remove(researchJobId);
    } catch {
      // ignore — job didn't exist or already removed
    }

    const bullJob = await queue.add(
      "research",
      {
        brandId,
        researchJobId,
        name: brand.name,
        website: brand.website ?? "",
        industry: brand.industry ?? "",
        trigger: "retry",
      },
      { jobId: researchJobId },
    );
    await admin
      .from("brand_research_jobs")
      .update({ bull_job_id: String(bullJob.id ?? researchJobId) })
      .eq("id", researchJobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enqueue";
    captureFallback("brands.retry.enqueue_failed", err, {
      brandId,
      researchJobId,
    });
    await admin
      .from("brand_research_jobs")
      .update({ status: "failed", error_message: message })
      .eq("id", researchJobId);
    await admin
      .from("brands")
      .update({ status: "failed" })
      .eq("id", brandId);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json(
    { brandId, researchJobId, status: "queued" },
    { status: 202 }, // Accepted — work is in flight
  );
}
