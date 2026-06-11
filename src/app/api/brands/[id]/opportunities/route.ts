/**
 * POST /api/brands/[id]/opportunities — Intelligence → Ideas (V2 Phase 2C)
 *
 * Mines the brand's stored evidence for content opportunities and persists
 * them as brand_topics rows (source='evidence-mined') so they flow through
 * every existing surface: topic pickers, generate deep-links, Grounding
 * Inspector.
 *
 * Pipeline (synchronous, no worker):
 *   1. Auth + ownership + rate limit (mining is a heavier Gemini call)
 *   2. Evidence digests: first chunk per source (summary preferred), ≤50
 *   3. mineOpportunities (4 lenses, strict per-idea [n] citations)
 *   4. Validation: drop ideas with no valid evidence refs — grounded only
 *   5. Composite scoring → brand_topics.confidence:
 *        0.45·model_confidence  (is this real and distinct?)
 *      + 0.20·evidence factor   (min(refs/4, 1) — multi-source beats hunch)
 *      + 0.15·freshness         (avg exp(-ageDays/45) over cited evidence)
 *      + 0.20·strategic fit     (alignment with positioning + pillars)
 *   6. Insert + return rows; run accounting recorded in research_runs
 *      (trigger='manual', facets=['opportunities']).
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";
import { captureFallback } from "@/lib/observability";
import {
  mineOpportunities,
  type EvidenceDigest,
  type OpportunityKind,
} from "@/lib/gemini";
import type { BrandProfile, DbBrandTopic } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const RATE_LIMIT = { limit: 6, windowSeconds: 60 * 60 } as const; // 6/hour
const ROUTE = "POST:/api/brands/[id]/opportunities";
const MAX_EVIDENCE = 50;

const VALID_CATEGORIES = new Set([
  "educational",
  "storytelling",
  "ugc",
  "product-demo",
  "listicle",
  "problem-solution",
  "founder-story",
]);
const VALID_KINDS = new Set<OpportunityKind>([
  "pain_point",
  "theme",
  "competitor_gap",
  "trend",
]);

// Mirrors the worker's research_runs cost constants (estimates, not billing).
const COST_PER_M_INPUT_USD = 0.3;
const COST_PER_M_OUTPUT_USD = 2.5;

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

  const rl = await rateLimit({
    key: `${ROUTE}:${userId}`,
    limit: RATE_LIMIT.limit,
    windowSeconds: RATE_LIMIT.windowSeconds,
  });
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "Too many opportunity scans this hour. Slow down.",
        retryAfterSeconds: rl.retryAfterSeconds,
      },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const admin = createAdminClient();

  // Ownership + context
  const { data: brand, error: brandErr } = await admin
    .from("brands")
    .select("id, user_id, name, industry, profile")
    .eq("id", brandId)
    .single();
  if (brandErr || !brand) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }
  if (brand.user_id !== userId) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  // Evidence digests: first chunk per source — carries the source's title +
  // capture-time summary (Phase 1.5 enrichment updates every chunk of a
  // source, so chunk 0 is a faithful source-level digest).
  const { data: evidenceRows, error: evErr } = await admin
    .from("research_documents")
    .select("id, source_type, domain, title, summary, content, captured_at")
    .eq("brand_id", brandId)
    .eq("deleted_by_user", false)
    .eq("chunk_index", 0)
    .order("captured_at", { ascending: false })
    .limit(MAX_EVIDENCE);
  if (evErr) {
    captureFallback("opportunities.evidence_load_failed", evErr, { brandId });
    return NextResponse.json({ error: "Failed to load evidence" }, { status: 500 });
  }
  if (!evidenceRows || evidenceRows.length === 0) {
    return NextResponse.json(
      {
        error:
          "No research evidence stored for this brand yet. Re-run research first — opportunities are mined from evidence only.",
      },
      { status: 409 },
    );
  }

  const [{ data: pillarRows }, { data: compRows }, { data: topicRows }] =
    await Promise.all([
      admin.from("content_pillars").select("name").eq("brand_id", brandId).limit(8),
      admin.from("competitors").select("name").eq("brand_id", brandId).limit(12),
      admin
        .from("brand_topics")
        .select("title")
        .eq("brand_id", brandId)
        .neq("status", "archived")
        .order("created_at", { ascending: false })
        .limit(60),
    ]);

  const digests: EvidenceDigest[] = evidenceRows.map((r, i) => ({
    n: i + 1,
    sourceType: r.source_type as string,
    domain: (r.domain as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    capturedAt: r.captured_at as string,
    digest:
      ((r.summary as string | null) ?? (r.content as string).slice(0, 400)).trim(),
  }));

  // Run accounting (existing table — trigger 'manual', dedicated facet).
  const startedAt = Date.now();
  const { data: runRow } = await admin
    .from("research_runs")
    .insert({
      brand_id: brandId,
      trigger: "manual",
      facets: ["opportunities"],
      status: "running",
    })
    .select("id")
    .single();
  const runId = (runRow?.id as string) ?? null;

  try {
    const profile = brand.profile as BrandProfile | null;
    const { data: mined, meta } = await mineOpportunities({
      brandName: brand.name as string,
      industry: (brand.industry as string | null) ?? null,
      positioning: profile?.positioning_statement ?? null,
      pillars: (pillarRows ?? []).map((p) => p.name as string),
      competitorNames: (compRows ?? []).map((c) => c.name as string),
      existingTopicTitles: (topicRows ?? []).map((t) => t.title as string),
      evidence: digests,
      targetCount: 10,
    });

    // Validation + scoring. Grounded ideas ONLY: invalid/empty refs → dropped.
    const now = Date.now();
    const rows: Array<Record<string, unknown>> = [];
    let dropped = 0;
    for (const opp of mined.opportunities ?? []) {
      const refs = [...new Set(opp.evidence_refs ?? [])].filter(
        (n) => Number.isInteger(n) && n >= 1 && n <= digests.length,
      );
      if (refs.length === 0 || !opp.title?.trim()) {
        dropped++;
        continue;
      }
      const citedDocs = refs.map((n) => evidenceRows[n - 1]);
      const evidenceFactor = Math.min(refs.length / 4, 1);
      const freshness =
        citedDocs.reduce((acc, d) => {
          const ageDays =
            (now - new Date(d.captured_at as string).getTime()) / 86_400_000;
          return acc + Math.exp(-Math.max(0, ageDays) / 45);
        }, 0) / citedDocs.length;
      const model = Math.min(Math.max(opp.model_confidence ?? 0, 0), 1);
      const strategic = Math.min(Math.max(opp.strategic_relevance ?? 0, 0), 1);
      const confidence = Number(
        (0.45 * model + 0.2 * evidenceFactor + 0.15 * freshness + 0.2 * strategic).toFixed(3),
      );

      rows.push({
        brand_id: brandId,
        title: opp.title.slice(0, 90),
        description: opp.description ?? null,
        category: VALID_CATEGORIES.has(opp.category) ? opp.category : "educational",
        seed_keyword: opp.seed_keyword ?? null,
        hook_angle: opp.hook_angle ?? null,
        source: "evidence-mined",
        status: "draft",
        grounded_on: citedDocs.map((d) => d.id as string),
        confidence,
        rationale: opp.rationale ?? null,
        opportunity_kind: VALID_KINDS.has(opp.opportunity_kind)
          ? opp.opportunity_kind
          : "theme",
      });
    }

    if (rows.length === 0) {
      if (runId) {
        await admin
          .from("research_runs")
          .update({
            status: "done",
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startedAt,
            tokens_input: meta.tokensInput,
            tokens_output: meta.tokensOutput,
          })
          .eq("id", runId);
      }
      return NextResponse.json(
        {
          error:
            "The evidence didn't support any well-grounded opportunities. Collect more research (re-run research) and try again.",
        },
        { status: 422 },
      );
    }

    const { data: inserted, error: insertErr } = await admin
      .from("brand_topics")
      .insert(rows)
      .select("*");
    if (insertErr) {
      throw new Error(`Failed to save opportunities: ${insertErr.message}`);
    }

    if (runId) {
      await admin
        .from("research_runs")
        .update({
          status: "done",
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
          sources_collected: digests.length,
          tokens_input: meta.tokensInput,
          tokens_output: meta.tokensOutput,
          cost_estimate_usd:
            (meta.tokensInput * COST_PER_M_INPUT_USD +
              meta.tokensOutput * COST_PER_M_OUTPUT_USD) /
            1_000_000,
        })
        .eq("id", runId);
    }

    return NextResponse.json({
      ideas: (inserted ?? []) as DbBrandTopic[],
      dropped,
      evidenceScanned: digests.length,
    });
  } catch (err) {
    captureFallback("opportunities.mining_failed", err, { brandId });
    if (runId) {
      await admin
        .from("research_runs")
        .update({
          status: "failed",
          error_message: err instanceof Error ? err.message : String(err),
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
        })
        .eq("id", runId);
    }
    return NextResponse.json(
      { error: "Opportunity mining failed — try again." },
      { status: 502 },
    );
  }
}
