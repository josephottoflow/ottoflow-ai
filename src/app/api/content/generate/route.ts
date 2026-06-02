/**
 * POST /api/content/generate
 *
 * Kick off a content-generation pipeline run for an existing brand.
 *
 * Body:
 *   {
 *     brandId:   string (uuid, required) — must belong to caller
 *     platform:  "linkedin" | "facebook" | "instagram" | "twitter" | "blog" | "email"
 *     userPrompt?: string  — optional topic/steering (max 500 chars)
 *     pillarId?: string    — optional content_pillars uuid
 *   }
 *
 * Side effects:
 *   1. Creates a content_items row (status='draft', body=null until worker finishes)
 *   2. Creates a content_generation_jobs row pointing at both
 *   3. Enqueues BullMQ "content-generation"
 *   4. Returns the IDs so the client can navigate to /content/[contentItemId]
 *
 * Shares the rate-limit bucket with brand creation since both kick off
 * heavy Gemini work — a malicious caller can't alternate to bypass.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { contentGenerationQueue } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { captureFallback } from "@/lib/observability";

export const runtime = "nodejs";

const PLATFORMS = [
  "linkedin",
  "facebook",
  "instagram",
  "twitter",
  "blog",
  "email",
] as const;

const Schema = z.object({
  brandId: z.string().uuid(),
  platform: z.enum(PLATFORMS),
  userPrompt: z.string().max(500).optional(),
  pillarId: z.string().uuid().optional(),
});

const RATE_LIMIT = { limit: 20, windowSeconds: 60 * 60 } as const; // 20/hr per user
const ROUTE = "POST:/api/content/generate";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit
  const rl = await rateLimit({
    key: `${ROUTE}:${userId}`,
    limit: RATE_LIMIT.limit,
    windowSeconds: RATE_LIMIT.windowSeconds,
  });
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "Too many content generations. Slow down.",
        retryAfterSeconds: rl.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const admin = createAdminClient();

  // 1. Verify brand exists, owner matches, has profile
  const { data: brand, error: brandErr } = await admin
    .from("brands")
    .select("id, name, user_id, status, profile")
    .eq("id", input.brandId)
    .single();

  if (brandErr || !brand) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }
  if (brand.user_id !== userId) {
    // Don't leak existence to non-owners
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }
  if (!brand.profile) {
    return NextResponse.json(
      {
        error:
          "This brand has no research yet. Run brand research first, then generate content.",
      },
      { status: 409 },
    );
  }

  // 2. Optional pillar — verify it belongs to the same brand
  if (input.pillarId) {
    const { data: pillar } = await admin
      .from("content_pillars")
      .select("id, brand_id")
      .eq("id", input.pillarId)
      .maybeSingle();
    if (!pillar || pillar.brand_id !== input.brandId) {
      return NextResponse.json(
        { error: "Selected pillar doesn't belong to this brand." },
        { status: 400 },
      );
    }
  }

  // 3. Create content_items row (placeholder — title fills in when worker writes)
  const placeholderTitle = `Generating ${input.platform} content…`;
  const { data: item, error: itemErr } = await admin
    .from("content_items")
    .insert({
      brand_id: input.brandId,
      platform: input.platform,
      title: placeholderTitle,
      preview: "",
      body: null,
      status: "draft",
      user_prompt: input.userPrompt ?? null,
    })
    .select("id")
    .single();

  if (itemErr || !item) {
    return NextResponse.json(
      { error: itemErr?.message ?? "Failed to create content row" },
      { status: 500 },
    );
  }

  // 4. Create job row
  const { data: job, error: jobErr } = await admin
    .from("content_generation_jobs")
    .insert({
      brand_id: input.brandId,
      content_item_id: item.id,
      status: "queued",
      current_step: "queued",
      progress: 0,
      platform: input.platform,
      user_prompt: input.userPrompt ?? null,
      pillar_id: input.pillarId ?? null,
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    // Best-effort cleanup
    await admin.from("content_items").delete().eq("id", item.id);
    return NextResponse.json(
      { error: jobErr?.message ?? "Failed to create content job" },
      { status: 500 },
    );
  }

  // 5. Enqueue BullMQ — same jobId-equals-uuid pattern as brand research so
  //    retries can de-dup via queue.remove(jobId) cleanly.
  try {
    const queue = contentGenerationQueue();
    const bullJob = await queue.add(
      "generate",
      {
        brandId: input.brandId,
        contentItemId: item.id,
        contentJobId: job.id,
        platform: input.platform,
        userPrompt: input.userPrompt,
        pillarId: input.pillarId,
      },
      { jobId: job.id },
    );
    await admin
      .from("content_generation_jobs")
      .update({ bull_job_id: String(bullJob.id ?? job.id) })
      .eq("id", job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enqueue";
    captureFallback("content.generate.enqueue_failed", err, {
      brandId: input.brandId,
      contentJobId: job.id,
    });
    await admin
      .from("content_generation_jobs")
      .update({ status: "failed", error_message: message })
      .eq("id", job.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json(
    {
      contentItemId: item.id,
      contentJobId: job.id,
      platform: input.platform,
    },
    {
      status: 202,
      headers: {
        "X-RateLimit-Limit": String(rl.limit),
        "X-RateLimit-Remaining": String(Math.max(0, rl.limit - rl.used)),
      },
    },
  );
}
