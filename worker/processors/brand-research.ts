/**
 * Brand Research processor — runs the multi-step research pipeline for a brand.
 *
 * Each step:
 *   1. Updates brand_research_jobs.current_step + progress
 *   2. Appends a structured log entry (so the UI can stream it via Realtime)
 *   3. Calls the appropriate Gemini helper
 *
 * On success: writes brand.profile + brand.status='ready', inserts competitor,
 * keyword, and content_pillar rows.
 * On failure: brand.status='failed', error_message captured.
 */
import { createAdminClient } from "@/lib/supabase";
import {
  extractBrandProfileFull,
  findCompetitorsFull,
  generateSEOBundleFull,
  generateBrandTopicsFull,
  type GenerationMeta,
} from "@/lib/gemini";
import {
  storeEvidence,
  fetchPageText,
  type EvidenceInput,
} from "@/lib/evidence";
import type { BrandResearchJobData } from "@/lib/queue";
import type { ResearchLogEntry } from "@/lib/types";

// Cost-estimate constants for research_runs.cost_estimate_usd. Approximate
// public Gemini 2.5 Flash pricing (USD per 1M tokens) — an ESTIMATE for ops
// visibility, not billing.
const COST_PER_M_INPUT_USD = 0.3;
const COST_PER_M_OUTPUT_USD = 2.5;

// How many urlContext-retrieved pages we re-fetch ourselves for full-text
// evidence (beyond the homepage, which is always fetched).
const MAX_EXTRA_PAGES = 3;

type Reporter = (step: string, progress: number) => void;

interface StepDef {
  key: string;             // matches current_step
  label: string;           // human readable
  progressAt: number;      // progress when step finishes
}

const STEPS: Record<string, StepDef> = {
  fetching_site:       { key: "fetching_site",       label: "Fetching website",            progressAt: 10 },
  extracting_profile:  { key: "extracting_profile",  label: "Extracting brand profile",    progressAt: 40 },
  finding_competitors: { key: "finding_competitors", label: "Researching competitors",     progressAt: 60 },
  generating_seo:      { key: "generating_seo",      label: "Generating SEO + pillars",    progressAt: 78 },
  generating_topics:   { key: "generating_topics",   label: "Generating content topics",   progressAt: 92 },
  finalizing:          { key: "finalizing",          label: "Saving results",              progressAt: 100 },
};

export async function processBrandResearch(
  data: BrandResearchJobData,
  report: Reporter
): Promise<{ ok: true }> {
  const admin = createAdminClient();
  const { researchJobId, brandId } = data;

  // ─── Helpers ──────────────────────────────────────────────────────────────
  async function startStep(step: StepDef) {
    await admin
      .from("brand_research_jobs")
      .update({
        status: "running",
        current_step: step.key,
      })
      .eq("id", researchJobId);
    report(step.key, Math.max(0, step.progressAt - 8));
    await appendLog({
      ts: new Date().toISOString(),
      level: "info",
      step: step.key,
      message: `Started: ${step.label}`,
    });
  }

  async function finishStep(step: StepDef, msg: string, meta?: Record<string, unknown>) {
    await admin
      .from("brand_research_jobs")
      .update({ progress: step.progressAt })
      .eq("id", researchJobId);
    report(step.key, step.progressAt);
    await appendLog({
      ts: new Date().toISOString(),
      level: "success",
      step: step.key,
      message: msg,
      meta,
    });
  }

  async function appendLog(entry: ResearchLogEntry) {
    // Use the SQL-side append helper to avoid read-modify-write races.
    // Cast: Functions aren't typed in the Database definition.
    await admin.rpc("append_research_log", { job_id: researchJobId, entry });
  }

  // ─── V2 Phase 1: run accounting + evidence state ──────────────────────────
  // Declared outside the try so the catch can finalize the run row.
  let runId: string | null = null;
  const startedAt = Date.now();
  let tokensInput = 0;
  let tokensOutput = 0;
  let sourcesCollected = 0;
  let chunksStored = 0;
  let chunksEmbedded = 0;
  const websiteDocIds: string[] = [];
  const searchDocIds: string[] = [];

  const addUsage = (meta: GenerationMeta) => {
    tokensInput += meta.tokensInput;
    tokensOutput += meta.tokensOutput;
  };
  const addStore = (r: {
    sourcesCollected: number;
    chunksStored: number;
    chunksEmbedded: number;
  }) => {
    sourcesCollected += r.sourcesCollected;
    chunksStored += r.chunksStored;
    chunksEmbedded += r.chunksEmbedded;
  };

  try {
    // ─── Create the research_runs row (traceability for this execution) ─────
    const { data: runRow } = await admin
      .from("research_runs")
      .insert({
        brand_id: brandId,
        research_job_id: researchJobId,
        trigger: data.trigger ?? "create",
        status: "running",
      })
      .select("id")
      .single();
    runId = (runRow?.id as string) ?? null;

    // ─── Mark brand as researching ──────────────────────────────────────────
    await admin.from("brands").update({ status: "researching" }).eq("id", brandId);

    // ─── Step 1: Fetch the homepage OURSELVES and persist it as evidence ────
    // (Gemini also reads it via urlContext, but that fetch was invisible —
    // this one is stored. Evidence is never lost again.)
    await startStep(STEPS.fetching_site);
    const homepage = await fetchPageText(data.website);
    if (homepage) {
      const stored = await storeEvidence(admin, {
        brandId,
        runId,
        sources: [
          {
            sourceType: "website",
            url: data.website,
            title: homepage.title,
            content: homepage.text,
            metadata: { kind: "homepage" },
          },
        ],
      });
      websiteDocIds.push(...stored.documentIds);
      addStore(stored);
    }
    await finishStep(
      STEPS.fetching_site,
      homepage
        ? `Fetched ${data.website} — ${websiteDocIds.length} evidence chunks stored`
        : `Fetching ${data.website} (page not directly fetchable — relying on Gemini URL context)`,
    );

    // ─── Step 2: Extract profile (grounded; urlContext fetches the site) ────
    await startStep(STEPS.extracting_profile);
    const { data: profile, meta: profileMeta } = await extractBrandProfileFull({
      name: data.name,
      website: data.website,
      industry: data.industry,
    });
    addUsage(profileMeta);

    // Persist any ADDITIONAL pages Gemini read via urlContext (About,
    // Services, Pricing…) — fetch their full text ourselves.
    const alreadyFetched = new Set([data.website.replace(/\/$/, "")]);
    const extraUrls = profileMeta.sources
      .filter((s) => s.sourceType === "website")
      .map((s) => s.url.replace(/\/$/, ""))
      .filter((u) => !alreadyFetched.has(u))
      .slice(0, MAX_EXTRA_PAGES);
    if (extraUrls.length > 0) {
      const pages: EvidenceInput[] = [];
      for (const url of extraUrls) {
        const page = await fetchPageText(url);
        if (page) {
          pages.push({
            sourceType: "website",
            url,
            title: page.title,
            content: page.text,
            metadata: { kind: "subpage", discoveredVia: "urlContext" },
          });
        }
      }
      if (pages.length > 0) {
        const stored = await storeEvidence(admin, { brandId, runId, sources: pages });
        websiteDocIds.push(...stored.documentIds);
        addStore(stored);
      }
    }

    await finishStep(STEPS.extracting_profile, "Brand profile extracted", {
      services: profile.services.length,
      personas: profile.personas.length,
      seed_keywords: profile.seed_keywords.length,
      evidence_chunks: websiteDocIds.length,
    });

    // Store profile early so the UI can preview it while later steps run.
    await admin
      .from("brands")
      .update({ profile, name: data.name, industry: data.industry })
      .eq("id", brandId);

    // ─── Step 3: Competitors (grounded via Google Search) ───────────────────
    await startStep(STEPS.finding_competitors);
    const { data: competitors, meta: compMeta } = await findCompetitorsFull({
      name: data.name,
      website: data.website,
      industry: data.industry,
      positioning: profile.positioning_statement,
      seedCompetitors: profile.seed_competitors,
    });
    addUsage(compMeta);

    // Persist the Google Search grounding sources — which results backed the
    // competitor analysis, with the supported text segments as snippets.
    const searchSources: EvidenceInput[] = compMeta.sources
      .filter((s) => s.sourceType === "search_result")
      .map((s) => ({
        sourceType: "search_result" as const,
        url: s.url,
        title: s.title ?? null,
        content:
          s.snippet ??
          `Google Search source consulted for competitor research: ${s.title ?? s.url}`,
        metadata: { groundedCall: "findCompetitors", redirectUrl: true },
      }));
    if (searchSources.length > 0) {
      const stored = await storeEvidence(admin, {
        brandId,
        runId,
        sources: searchSources,
      });
      searchDocIds.push(...stored.documentIds);
      addStore(stored);
    }

    if (competitors.length > 0) {
      await admin.from("competitors").insert(
        competitors.map((c) => ({
          ...c,
          brand_id: brandId,
          source: "google_search",
        }))
      );
    }
    await finishStep(
      STEPS.finding_competitors,
      `Found ${competitors.length} competitors (${searchSources.length} search sources persisted)`,
    );

    // ─── Step 4: SEO + content pillars ──────────────────────────────────────
    await startStep(STEPS.generating_seo);
    const { data: seoBundle, meta: seoMeta } = await generateSEOBundleFull({
      name: data.name,
      industry: data.industry,
      positioning: profile.positioning_statement,
      audience:
        profile.audience.demographics.concat(profile.audience.psychographics).join("; "),
      seedKeywords: profile.seed_keywords,
      services: profile.services,
      personas: profile.personas,
    });

    addUsage(seoMeta);
    const { keywords, pillars } = seoBundle;

    if (keywords.length > 0) {
      await admin
        .from("keywords")
        .insert(keywords.map((k) => ({ ...k, brand_id: brandId })));
    }
    if (pillars.length > 0) {
      await admin
        .from("content_pillars")
        .insert(pillars.map((p) => ({ ...p, brand_id: brandId })));
    }

    await finishStep(STEPS.generating_seo, `Generated ${keywords.length} keywords + ${pillars.length} pillars`);

    // ─── Step 5: Brand Topics (best-effort) ─────────────────────────────────
    // Generates 30-50 on-brand video topic ideas that the Video Pipeline can
    // drive from. Best-effort — if Gemini fails here, the brand is STILL
    // marked ready; user can hit POST /api/brands/[id]/topics/generate to
    // retry. We don't want a topic-generation hiccup to invalidate a 60s
    // research run.
    await startStep(STEPS.generating_topics);
    // Ideas are grounded on the evidence that informed the profile +
    // competitor analysis (coarse, run-level attribution — per-idea evidence
    // mapping comes with the dedicated Ideation agent).
    const topicGrounding = [...websiteDocIds.slice(0, 12), ...searchDocIds.slice(0, 8)];
    try {
      const { data: topicBundle, meta: topicsMeta } = await generateBrandTopicsFull({
        brand: {
          name: data.name,
          industry: data.industry,
          profile,
        },
        seedKeywords: profile.seed_keywords,
        competitorNames: competitors.map((c) => c.name),
        pillarHints: pillars.map((p) => ({
          name: p.name,
          example_topics: p.example_topics ?? [],
        })),
        targetCount: 40,
      });
      addUsage(topicsMeta);

      if (topicBundle.topics.length > 0) {
        await admin.from("brand_topics").insert(
          topicBundle.topics.map((t) => ({
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
      }
      await finishStep(
        STEPS.generating_topics,
        `Generated ${topicBundle.topics.length} brand topics`,
        { count: topicBundle.topics.length },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Log the failure but DON'T throw — brand stays usable without topics.
      await appendLog({
        ts: new Date().toISOString(),
        level: "warn",
        step: STEPS.generating_topics.key,
        message: `Topics skipped: ${message}`,
      });
    }

    // ─── Finalize ───────────────────────────────────────────────────────────
    await startStep(STEPS.finalizing);

    // Intelligence versioning + source attribution (coarse section→evidence
    // map; same JSONB shape supports per-field paths later without migration).
    const { data: brandRow } = await admin
      .from("brands")
      .select("profile_version")
      .eq("id", brandId)
      .single();
    const intelligenceVersion = ((brandRow?.profile_version as number) ?? 0) + 1;

    await admin
      .from("brands")
      .update({
        status: "ready",
        profile_version: intelligenceVersion,
        profile_citations: {
          profile: websiteDocIds,
          competitors: searchDocIds,
        },
        last_research_run_id: runId,
      })
      .eq("id", brandId);

    if (runId) {
      await admin
        .from("research_runs")
        .update({
          status: "done",
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
          sources_collected: sourcesCollected,
          chunks_stored: chunksStored,
          chunks_embedded: chunksEmbedded,
          tokens_input: tokensInput,
          tokens_output: tokensOutput,
          cost_estimate_usd:
            (tokensInput * COST_PER_M_INPUT_USD + tokensOutput * COST_PER_M_OUTPUT_USD) /
            1_000_000,
          intelligence_version: intelligenceVersion,
        })
        .eq("id", runId);
    }
    await admin
      .from("brand_research_jobs")
      .update({
        status: "done",
        current_step: STEPS.finalizing.key,
        progress: 100,
        completed_at: new Date().toISOString(),
      })
      .eq("id", researchJobId);

    await admin.from("activity").insert({
      type: "brand_researched",
      message: `Brand "${data.name}" research complete`,
      project_id: null,
      project_name: data.name,
      meta: { brand_id: brandId },
    });
    await appendLog({
      ts: new Date().toISOString(),
      level: "success",
      step: "finalizing",
      message: "All done — brand is ready",
    });

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("brand_research_jobs")
      .update({
        status: "failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", researchJobId);
    await admin.from("brands").update({ status: "failed" }).eq("id", brandId);

    // Close out the run row — evidence stored before the failure is KEPT
    // (partial research is still accumulated knowledge).
    if (runId) {
      await admin
        .from("research_runs")
        .update({
          status: "failed",
          error_message: message,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
          sources_collected: sourcesCollected,
          chunks_stored: chunksStored,
          chunks_embedded: chunksEmbedded,
          tokens_input: tokensInput,
          tokens_output: tokensOutput,
        })
        .eq("id", runId);
    }

    await admin.rpc("append_research_log", {
      job_id: researchJobId,
      entry: {
        ts: new Date().toISOString(),
        level: "error",
        step: "error",
        message,
      },
    });
    throw err;
  }
}
