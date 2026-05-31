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
  extractBrandProfile,
  findCompetitors,
  generateSEOBundle,
} from "@/lib/gemini";
import type { BrandResearchJobData } from "@/lib/queue";
import type { ResearchLogEntry } from "@/lib/types";

type Reporter = (step: string, progress: number) => void;

interface StepDef {
  key: string;             // matches current_step
  label: string;           // human readable
  progressAt: number;      // progress when step finishes
}

const STEPS: Record<string, StepDef> = {
  fetching_site:       { key: "fetching_site",       label: "Fetching website",            progressAt: 10 },
  extracting_profile:  { key: "extracting_profile",  label: "Extracting brand profile",    progressAt: 45 },
  finding_competitors: { key: "finding_competitors", label: "Researching competitors",     progressAt: 70 },
  generating_seo:      { key: "generating_seo",      label: "Generating SEO + pillars",    progressAt: 90 },
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

  try {
    // ─── Mark brand as researching ──────────────────────────────────────────
    await admin.from("brands").update({ status: "researching" }).eq("id", brandId);

    // ─── Step 1+2: Fetch + extract profile (Gemini does the fetch via URL ctx) ─
    await startStep(STEPS.fetching_site);
    await finishStep(STEPS.fetching_site, `Fetching ${data.website}`);

    await startStep(STEPS.extracting_profile);
    const profile = await extractBrandProfile({
      name: data.name,
      website: data.website,
      industry: data.industry,
    });
    await finishStep(STEPS.extracting_profile, "Brand profile extracted", {
      services: profile.services.length,
      personas: profile.personas.length,
      seed_keywords: profile.seed_keywords.length,
    });

    // Store profile early so the UI can preview it while later steps run.
    await admin
      .from("brands")
      .update({ profile, name: data.name, industry: data.industry })
      .eq("id", brandId);

    // ─── Step 3: Competitors ────────────────────────────────────────────────
    await startStep(STEPS.finding_competitors);
    const competitors = await findCompetitors({
      name: data.name,
      website: data.website,
      industry: data.industry,
      positioning: profile.positioning_statement,
      seedCompetitors: profile.seed_competitors,
    });
    if (competitors.length > 0) {
      await admin.from("competitors").insert(
        competitors.map((c) => ({
          ...c,
          brand_id: brandId,
          source: "google_search",
        }))
      );
    }
    await finishStep(STEPS.finding_competitors, `Found ${competitors.length} competitors`);

    // ─── Step 4: SEO + content pillars ──────────────────────────────────────
    await startStep(STEPS.generating_seo);
    const { keywords, pillars } = await generateSEOBundle({
      name: data.name,
      industry: data.industry,
      positioning: profile.positioning_statement,
      audience:
        profile.audience.demographics.concat(profile.audience.psychographics).join("; "),
      seedKeywords: profile.seed_keywords,
      services: profile.services,
      personas: profile.personas,
    });

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

    // ─── Finalize ───────────────────────────────────────────────────────────
    await startStep(STEPS.finalizing);
    await admin.from("brands").update({ status: "ready" }).eq("id", brandId);
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
