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

const Schema = z
  .object({
    brandId: z.string().uuid(),
    // New: multi-platform in one run. `platform` (single) kept for back-compat.
    platforms: z.array(z.enum(PLATFORMS)).min(1).max(PLATFORMS.length).optional(),
    platform: z.enum(PLATFORMS).optional(),
    // New: align the post to a researched idea (brand_topics).
    topicId: z.string().uuid().optional(),
    userPrompt: z.string().max(500).optional(),
    pillarId: z.string().uuid().optional(),
    // Per-creative branding overrides (Brand Creative Orchestrator) — captured
    // on /content/generate, persisted on the item, consumed by composeCreativeBrief.
    branding: z
      .object({
        companyName: z.string().max(120).optional(),
        founderName: z.string().max(120).optional(),
        expertName: z.string().max(120).optional(),
        useLogo: z.boolean().optional(),
        useHeadshot: z.boolean().optional(),
        // Text Overlay (COS migration M2D) — the shared Creative OS control.
        // Absent by default → composeCreativeBrief leaves the brief unchanged.
        textOverlay: z.boolean().optional(),
        textStyle: z.enum(["premium", "impact", "founder", "legacy"]).optional(),
      })
      .optional(),
  })
  .refine((v) => !!v.platforms?.length || !!v.platform, {
    message: "Provide at least one platform.",
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
  const platforms = input.platforms ?? (input.platform ? [input.platform] : []);

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

  // 2b. Optional researched idea (brand_topics) — resolve it into a topic-
  // aligned steering block that we fold into the Gemini "userPrompt". The
  // worker already treats userPrompt as the topic/steering, so this needs NO
  // worker or schema change — the post comes out aligned to the idea's hook
  // and angle (same pattern as the video route).
  let topicTitle: string | null = null;
  let topicGrounding: string[] = [];
  let effectiveUserPrompt = input.userPrompt?.trim() || undefined;
  if (input.topicId) {
    const { data: topic, error: topicErr } = await admin
      .from("brand_topics")
      .select(
        "id, brand_id, title, description, category, hook_angle, seed_keyword, grounded_on",
      )
      .eq("id", input.topicId)
      .eq("brand_id", input.brandId)
      .maybeSingle();
    if (topicErr || !topic) {
      return NextResponse.json(
        { error: "Selected idea doesn't belong to this brand." },
        { status: 400 },
      );
    }
    topicTitle = topic.title as string;
    // V2 Phase 1 — artifacts inherit the idea's evidence grounding, so future
    // analytics can attribute performance back to research sources.
    topicGrounding = (topic.grounded_on as string[] | null) ?? [];
    const topicBlock = [
      `Topic: ${topic.title}.`,
      topic.hook_angle ? `Lead with this hook angle: "${topic.hook_angle}".` : "",
      topic.description ? `Core angle: ${topic.description}` : "",
      topic.category ? `Content type: ${topic.category}.` : "",
      topic.seed_keyword ? `Anchor keyword: ${topic.seed_keyword}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    effectiveUserPrompt = [topicBlock, input.userPrompt?.trim()]
      .filter(Boolean)
      .join("\n\nExtra direction: ");

    // Mark the idea as used (atomic increment, fire-and-forget) for parity
    // with the video flow so the same idea de-prioritises on next browse.
    void (async () => {
      try {
        await admin.rpc(
          "increment_brand_topic_use" as never,
          { p_topic_id: input.topicId } as never,
        );
      } catch (e) {
        captureFallback("content.generate.topic_use_increment_failed", e, {
          topicId: input.topicId,
        });
      }
    })();
  }

  // 3-5. Create one content_item + job per selected platform, then enqueue
  // each. The worker handles exactly one platform per job, so multi-platform
  // is just N jobs — no worker change. effectiveUserPrompt carries the topic
  // alignment block so every platform's post stays on-idea.
  const generations: Array<{
    platform: string;
    contentItemId: string;
    contentJobId: string;
  }> = [];
  const createdItemIds: string[] = [];

  for (const pf of platforms) {
    const { data: item, error: itemErr } = await admin
      .from("content_items")
      .insert({
        brand_id: input.brandId,
        platform: pf,
        title: `Generating ${pf} content…`,
        preview: "",
        body: null,
        status: "draft",
        user_prompt: effectiveUserPrompt ?? null,
        grounded_on: topicGrounding,
        // Phase 1.5 — direct post→idea lineage (was only implicit in the
        // prompt text; videos already carried topic_id on render_jobs).
        topic_id: input.topicId ?? null,
        // Creative Orchestrator — branding overrides for the eventual creative.
        creative_branding: input.branding ?? null,
      })
      .select("id")
      .single();

    if (itemErr || !item) {
      if (createdItemIds.length) {
        await admin.from("content_items").delete().in("id", createdItemIds);
      }
      return NextResponse.json(
        { error: itemErr?.message ?? "Failed to create content row" },
        { status: 500 },
      );
    }
    createdItemIds.push(item.id as string);

    const { data: job, error: jobErr } = await admin
      .from("content_generation_jobs")
      .insert({
        brand_id: input.brandId,
        content_item_id: item.id,
        status: "queued",
        current_step: "queued",
        progress: 0,
        platform: pf,
        user_prompt: effectiveUserPrompt ?? null,
        pillar_id: input.pillarId ?? null,
      })
      .select("id")
      .single();

    if (jobErr || !job) {
      await admin.from("content_items").delete().in("id", createdItemIds);
      return NextResponse.json(
        { error: jobErr?.message ?? "Failed to create content job" },
        { status: 500 },
      );
    }

    try {
      const bullJob = await contentGenerationQueue().add(
        "generate",
        {
          brandId: input.brandId,
          contentItemId: item.id,
          contentJobId: job.id,
          platform: pf,
          userPrompt: effectiveUserPrompt,
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

    generations.push({
      platform: pf,
      contentItemId: item.id as string,
      contentJobId: job.id as string,
    });
  }

  return NextResponse.json(
    {
      generations,
      topicTitle,
      // Back-compat single-result fields (first platform) for older callers.
      contentItemId: generations[0]?.contentItemId,
      contentJobId: generations[0]?.contentJobId,
      platform: generations[0]?.platform,
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
