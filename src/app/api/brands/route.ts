import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { brandResearchQueue } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import {
  parseIdempotencyKey,
  getCachedResponse,
  setCachedResponse,
} from "@/lib/idempotency";

export const runtime = "nodejs";

const CreateBrandSchema = z.object({
  name: z.string().min(1).max(200),
  website: z.string().url(),
  industry: z.string().min(1).max(120),
});

// Per-user rate limit on brand creation. Tuned for the brand-research engine
// where each call queues a multi-minute Gemini job — anything beyond a handful
// per hour from a single user is almost certainly script abuse or a runaway
// client retry loop.
const RATE_LIMIT = { limit: 10, windowSeconds: 60 * 60 } as const; // 10/hour
const ROUTE = "POST:/api/brands";

interface CreateBrandResponse {
  brandId: string;
  researchJobId: string;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Idempotency check (before rate limit, so retries don't consume budget)
  // Client may send `Idempotency-Key: <token>` to make this POST safely
  // retryable. We cache the successful 201 for 24h and replay it verbatim on
  // duplicates. Mid-flight collisions are NOT handled (no in-flight lock):
  // worst case two near-simultaneous identical retries both execute and
  // create two brands — same outcome as today, but the more common
  // network-blip-then-retry pattern is fixed.
  const idemKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (idemKey) {
    const cached = await getCachedResponse<CreateBrandResponse>(userId, ROUTE, idemKey);
    if (cached) {
      return NextResponse.json(cached, {
        status: 200, // 200 (not 201) signals "this is a replay, not a fresh create"
        headers: { "Idempotency-Replay": "true" },
      });
    }
  }

  // ── Rate limit (sliding window, per-user)
  const rl = await rateLimit({
    key: `${ROUTE}:${userId}`,
    limit: RATE_LIMIT.limit,
    windowSeconds: RATE_LIMIT.windowSeconds,
  });
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "Too many brand creations. Slow down.",
        limit: rl.limit,
        windowSeconds: RATE_LIMIT.windowSeconds,
        retryAfterSeconds: rl.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfterSeconds),
          "X-RateLimit-Limit": String(rl.limit),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateBrandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const admin = createAdminClient();

  // 1. Create brand row (user_id from Clerk, status pending until worker picks up)
  const { data: brand, error: brandErr } = await admin
    .from("brands")
    .insert({
      user_id: userId,
      name: input.name,
      website: input.website,
      industry: input.industry,
      status: "pending",
    })
    .select()
    .single();

  if (brandErr || !brand) {
    return NextResponse.json(
      { error: brandErr?.message ?? "Failed to create brand" },
      { status: 500 }
    );
  }

  // 2. Create research-job row
  const { data: job, error: jobErr } = await admin
    .from("brand_research_jobs")
    .insert({
      brand_id: brand.id,
      status: "queued",
      current_step: "queued",
      progress: 0,
    })
    .select()
    .single();

  if (jobErr || !job) {
    // Best effort cleanup
    await admin.from("brands").delete().eq("id", brand.id);
    return NextResponse.json(
      { error: jobErr?.message ?? "Failed to create research job" },
      { status: 500 }
    );
  }

  // 3. Enqueue BullMQ job
  try {
    const queue = brandResearchQueue();
    const bullJob = await queue.add(
      "research",
      {
        brandId: brand.id,
        researchJobId: job.id,
        name: brand.name,
        website: brand.website ?? input.website,
        industry: brand.industry ?? input.industry,
        trigger: "create",
      },
      { jobId: job.id }
    );
    await admin
      .from("brand_research_jobs")
      .update({ bull_job_id: String(bullJob.id ?? job.id) })
      .eq("id", job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enqueue";
    await admin
      .from("brand_research_jobs")
      .update({ status: "failed", error_message: message })
      .eq("id", job.id);
    await admin.from("brands").update({ status: "failed" }).eq("id", brand.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const responseBody: CreateBrandResponse = { brandId: brand.id, researchJobId: job.id };

  // Persist for idempotent retries (best-effort; never blocks the response).
  if (idemKey) {
    await setCachedResponse(userId, ROUTE, idemKey, responseBody);
  }

  return NextResponse.json(responseBody, {
    status: 201,
    headers: {
      "X-RateLimit-Limit": String(rl.limit),
      "X-RateLimit-Remaining": String(Math.max(0, rl.limit - rl.used)),
    },
  });
}
