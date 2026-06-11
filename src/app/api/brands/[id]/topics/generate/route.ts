/**
 * POST /api/brands/[id]/topics/generate
 *
 * Manually (re)generate the brand_topics batch for a brand. Useful when:
 *   - The auto-run during brand research failed (logged "Topics skipped")
 *   - User wants a fresh batch with different seed_keywords
 *   - We've shipped a better generateBrandTopics() prompt
 *
 * Synchronous — runs the Gemini call inline (no BullMQ). The call takes
 * ~10-30s and we want immediate feedback. The route extends maxDuration
 * to handle it.
 *
 * Guards:
 *   - Caller must own the brand
 *   - Brand must have a profile (research must have completed at least once)
 *   - Rate-limited to 10/hr per user (Gemini costs add up if abused)
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";
import { captureFallback } from "@/lib/observability";
import { generateBrandTopics } from "@/lib/gemini";
import type { BrandProfile } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90; // Gemini structured-output run + DB insert

const RATE_LIMIT = { limit: 10, windowSeconds: 60 * 60 } as const;
const ROUTE = "POST:/api/brands/[id]/topics/generate";

export async function POST(
  req: NextRequest,
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

  // Rate limit
  const rl = await rateLimit({
    key: `${ROUTE}:${userId}`,
    limit: RATE_LIMIT.limit,
    windowSeconds: RATE_LIMIT.windowSeconds,
  });
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "Too many topic regenerations. Slow down.",
        retryAfterSeconds: rl.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      },
    );
  }

  // Optional body: { targetCount?: number, replaceExisting?: boolean }
  let opts: { targetCount?: number; replaceExisting?: boolean } = {};
  try {
    opts = await req.json();
  } catch {
    // empty body is fine
  }

  const targetCount = Math.max(10, Math.min(80, opts.targetCount ?? 40));
  const replaceExisting = !!opts.replaceExisting;

  const admin = createAdminClient();

  // Ownership + profile guard
  const { data: brand, error: brandErr } = await admin
    .from("brands")
    .select("id, name, industry, user_id, profile, status")
    .eq("id", brandId)
    .single();

  if (brandErr || !brand) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }
  if (brand.user_id !== userId) {
    // 404 to avoid existence leak
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }
  if (!brand.profile) {
    return NextResponse.json(
      {
        error:
          "Brand has no profile yet. Wait for brand research to complete before generating topics.",
      },
      { status: 409 },
    );
  }

  // Pull seed keywords + competitor names + pillars for richer context.
  const [{ data: seedRows }, { data: compRows }, { data: pillarRows }] =
    await Promise.all([
      admin.from("keywords").select("term").eq("brand_id", brandId).limit(15),
      admin.from("competitors").select("name").eq("brand_id", brandId).limit(10),
      admin
        .from("content_pillars")
        .select("name, example_topics")
        .eq("brand_id", brandId)
        .limit(6),
    ]);

  let topics;
  try {
    const bundle = await generateBrandTopics({
      brand: {
        name: brand.name as string,
        industry: (brand.industry as string | null) ?? null,
        profile: brand.profile as unknown as BrandProfile,
      },
      seedKeywords: (seedRows ?? []).map((r) => r.term as string),
      competitorNames: (compRows ?? []).map((r) => r.name as string),
      pillarHints: (pillarRows ?? []).map((r) => ({
        name: r.name as string,
        example_topics: (r.example_topics as string[] | null) ?? [],
      })),
      targetCount,
    });
    topics = bundle.topics;
  } catch (err) {
    captureFallback("brand.topics.generate_failed", err, {
      brandId,
      targetCount,
    });
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Topic generation failed",
      },
      { status: 502 },
    );
  }

  // Optional: archive the existing draft set before inserting the new one.
  if (replaceExisting) {
    await admin
      .from("brand_topics")
      .update({ status: "archived" })
      .eq("brand_id", brandId)
      .eq("status", "draft");
  }

  // V2 Phase 1 — ground regenerated ideas on the brand's freshest website
  // evidence (coarse, source-set level). Best-effort: brands researched
  // before migration 010 have no evidence yet → empty grounding.
  let topicGrounding: string[] = [];
  try {
    const { data: evidenceRows } = await admin
      .from("research_documents")
      .select("id")
      .eq("brand_id", brandId)
      .eq("source_type", "website")
      .eq("deleted_by_user", false)
      .order("captured_at", { ascending: false })
      .limit(12);
    topicGrounding = (evidenceRows ?? []).map((r) => r.id as string);
  } catch {
    // table may not exist yet pre-migration — grounding stays empty
  }

  const { error: insertErr } = await admin.from("brand_topics").insert(
    topics.map((t) => ({
      brand_id: brandId,
      title: t.title,
      description: t.description,
      category: t.category,
      seed_keyword: t.seed_keyword,
      hook_angle: t.hook_angle,
      source: "ai-generated",
      status: "draft",
      grounded_on: topicGrounding,
    })),
  );

  if (insertErr) {
    captureFallback("brand.topics.insert_failed", insertErr, { brandId });
    return NextResponse.json(
      { error: `Failed to save topics: ${insertErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    count: topics.length,
    replacedExisting: replaceExisting,
  });
}
