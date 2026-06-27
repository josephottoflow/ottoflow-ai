/**
 * Campaign Execution processor (Sprint 25).
 *
 * Turns a campaign's strategy + package plan into REAL assets:
 *
 *   load        the campaign row + brand + assets
 *   strategy    plan the CampaignStrategy (Sprint 24) if not already attached
 *   orchestrate for each package asset, IN dependency order (hero → … →
 *               retargeting): synthesize its content from the strategy, compose
 *               a creative brief (CROSS-ASSET aware — each asset is told what its
 *               siblings already used, so it contributes something different),
 *               insert an APPROVED content_creative, and enqueue it through the
 *               existing creative-generation pipeline (generate → review →
 *               self-improve → ready).
 *   finalize    mark the campaign 'generating' with the realized asset_count.
 *
 * Campaign QA + progress are computed on read (GET /api/campaigns/[id]) from the
 * live asset states, so the customer sees "N of M assets complete" without this
 * job blocking on every render.
 */
import { createAdminClient } from "@/lib/supabase";
import { composeCreativeBrief } from "@/lib/creative/brief";
import { planCampaignStrategy, reviewCampaignStory, type CampaignStrategy } from "@/lib/gemini";
import { loadCampaignNarrativeMemory } from "@/lib/creative/campaign-strategy";
import { loadCreativeIntelligence } from "@/lib/creative/brand-intelligence";
import { loadPerformanceIntelligence } from "@/lib/creative/performance-intelligence";
import { orderPackage, synthesizeAssetContent, specializeForAsset, validateCampaignBlueprint } from "@/lib/creative/campaign-execution";
import { creativeGenerationQueue, type CampaignExecutionJobData } from "@/lib/queue";
import { captureFallback } from "@/lib/observability";
import { recordAIUsage } from "@/lib/ai-usage";
import type { DbBrand, DbBrandAsset } from "@/lib/types";

type Reporter = (step: string, progress: number) => void;

export async function processCampaignExecution(
  data: CampaignExecutionJobData,
  report: Reporter,
): Promise<{ ok: true; assetCount: number }> {
  const admin = createAdminClient();
  const { campaignId } = data;

  async function fail(err: unknown): Promise<never> {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("campaigns")
      .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
      .eq("id", campaignId);
    throw err instanceof Error ? err : new Error(message);
  }

  report("loading", 5);
  const { data: campaign, error: loadErr } = await admin
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();
  if (loadErr || !campaign) {
    throw new Error(`Campaign ${campaignId} not found: ${loadErr?.message ?? "missing"}`);
  }
  if (campaign.status !== "planning" && campaign.status !== "generating") {
    throw new Error(`Refusing to execute campaign ${campaignId}: status is '${campaign.status}'.`);
  }

  try {
    const { data: brandRow } = await admin
      .from("brands")
      .select("*")
      .eq("id", campaign.brand_id)
      .single();
    if (!brandRow) return fail(new Error("Campaign brand not found"));
    const brand = brandRow as DbBrand;

    const { data: assetRows } = await admin
      .from("brand_assets")
      .select("*")
      .eq("brand_id", campaign.brand_id)
      .order("created_at", { ascending: false });
    const assets = (assetRows ?? []) as DbBrandAsset[];

    // Brand + Performance Intelligence (once) — feeds the CMO's "what has worked"
    // reasoning AND every asset's creative brief. Loaded BEFORE planning.
    const [intelligence, performance] = await Promise.all([
      loadCreativeIntelligence(admin, campaign.brand_id as string, brand.industry).catch(() => null),
      loadPerformanceIntelligence(admin, campaign.brand_id as string, brand.industry).catch(() => null),
    ]);
    // Compact learning recap (reuses Performance + Brand Intelligence — no new call).
    const learningBits: string[] = [];
    if (performance && performance.measured_count > 0 && performance.winning_patterns.length) {
      learningBits.push(`Winning patterns: ${performance.winning_patterns.slice(0, 3).join("; ")}.`);
    }
    if (intelligence && intelligence.sample_size >= 3) {
      const bw = intelligence.best?.world?.[0];
      if (bw) learningBits.push(`Best-performing world: ${bw.value} (avg ${bw.avg_score}).`);
      if (intelligence.overused?.length) learningBits.push(`Avoid overused: ${intelligence.overused.join(", ")}.`);
    }
    const learningSummary = learningBits.join(" ");

    // ── Strategy: reuse the attached plan, else plan it now (CMO reasoning) ────
    report("strategy", 12);
    let strategy = campaign.strategy as CampaignStrategy | null;
    if (!strategy || !Array.isArray(strategy.package)) {
      const recentCampaigns = await loadCampaignNarrativeMemory(admin, campaign.brand_id as string);
      const p = brand.profile;
      const userId = (campaign.user_id as string | undefined) ?? "unknown";
      const pl0 = Date.now();
      const { data: planned, meta: planMeta } = await planCampaignStrategy({
        brand: {
          name: brand.name,
          industry: brand.industry,
          positioning: p?.positioning_statement ?? null,
          voiceTone: p?.brand_voice?.tone?.join(", ") || "Professional, clear, modern",
        },
        content: {
          title: (campaign.title as string | null) || (campaign.prompt as string),
          preview: null,
          bodyExcerpt: campaign.prompt as string,
          platform: campaign.platform as string,
        },
        topic: null,
        recentCampaigns,
        learningSummary,
      });
      await recordAIUsage(admin, {
        userId, provider: "gemini", operation: "planCampaignStrategy", purpose: "campaign", model: "gemini",
        campaignId, startedAt: pl0, completedAt: Date.now(), success: true,
        tokensInput: planMeta.tokensInput, tokensOutput: planMeta.tokensOutput,
      });
      // Deterministic validation = SOURCE OF TRUTH; Gemini CMO review = advisory.
      strategy = { ...planned, learning_summary: learningSummary };
      strategy.validation = validateCampaignBlueprint(strategy);
      report("reviewing", 16);
      const rv0 = Date.now();
      try {
        const { data: review, meta: reviewMeta } = await reviewCampaignStory(strategy, strategy.validation);
        strategy.story_review = review;
        await recordAIUsage(admin, {
          userId, provider: "gemini", operation: "reviewCampaignStory", purpose: "campaign", model: "gemini",
          campaignId, startedAt: rv0, completedAt: Date.now(), success: true,
          tokensInput: reviewMeta.tokensInput, tokensOutput: reviewMeta.tokensOutput,
        });
      } catch (err) {
        captureFallback("campaign.story_review_failed", err, { campaignId });
      }
      await admin
        .from("campaigns")
        .update({
          strategy,
          title: (campaign.title as string | null) || strategy.primary_objective.slice(0, 80),
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignId);
    }

    // ── Orchestrate the package in dependency order, cross-asset aware ────────
    const ordered = orderPackage(strategy.package);
    const siblings: string[] = []; // what earlier assets used → next asset avoids
    let created = 0;

    for (let i = 0; i < ordered.length; i++) {
      const asset = ordered[i];
      report("generating", 20 + Math.round((i / ordered.length) * 65));

      const content = synthesizeAssetContent(strategy, asset, campaign.platform as string);

      const { data: item, error: itemErr } = await admin
        .from("content_items")
        .insert({
          brand_id: campaign.brand_id,
          user_prompt: campaign.prompt,
          platform: campaign.platform,
          title: content.title,
          preview: content.preview,
          body: content.body,
          status: "approved",
          campaign_id: campaignId,
          campaign_role: asset.role,
        })
        .select("id")
        .single();
      if (itemErr || !item) {
        captureFallback("campaign.item_insert_failed", itemErr, { campaignId, role: asset.role });
        continue;
      }

      let composed;
      try {
        composed = await composeCreativeBrief({
          brand,
          assets,
          content: { title: content.title, preview: content.preview, body: content.body, platform: content.platform },
          topic: null,
          recentDirections: siblings,
          intelligence,
          performance,
          // Narrative-specialized frame — this asset advances ITS beat / CTA rung.
          campaign: specializeForAsset(strategy, asset),
        });
      } catch (err) {
        captureFallback("campaign.compose_failed", err, { campaignId, role: asset.role });
        continue;
      }
      const brief = composed.brief;

      const now = new Date().toISOString();
      const { data: creative, error: insErr } = await admin
        .from("content_creatives")
        .insert({
          content_item_id: item.id,
          brand_id: campaign.brand_id,
          campaign_id: campaignId,
          campaign_role: asset.role,
          status: "approved",
          creative_brief: brief,
          creative_hierarchy: brief.hierarchy,
          creative_confidence: brief.confidence,
          visual_tension: brief.visual_tension || null,
          visual_metaphor: brief.visual_metaphor || null,
          platform: brief.platform,
          status_history: [
            { from: null, to: "brief_ready", at: now, by: "system" },
            { from: "brief_ready", to: "approved", at: now, by: "system" },
          ],
        })
        .select("id")
        .single();
      if (insErr || !creative) {
        captureFallback("campaign.creative_insert_failed", insErr, { campaignId, role: asset.role });
        continue;
      }

      // Telemetry (Sprint 29.1) — record the generateCreativeConcept call(s) made
      // composing this asset's brief, now attributed to the creative + campaign.
      for (const u of composed.usage) {
        const done = Date.now();
        await recordAIUsage(admin, {
          userId: (campaign.user_id as string | undefined) ?? "unknown",
          provider: "gemini", operation: "generateCreativeConcept", purpose: "creative", model: "gemini",
          campaignId, creativeId: creative.id as string, contentItemId: item.id as string,
          startedAt: done - u.latencyMs, completedAt: done, success: true,
          tokensInput: u.tokensInput, tokensOutput: u.tokensOutput,
        });
      }

      // Enqueue through the EXISTING render pipeline (generate→review→improve).
      try {
        await creativeGenerationQueue().add(
          "generate",
          { creativeId: creative.id as string, brandId: campaign.brand_id as string },
          { jobId: `creative-${creative.id}` },
        );
      } catch (err) {
        captureFallback("campaign.enqueue_failed", err, { campaignId, creativeId: creative.id });
      }

      created++;
      siblings.push(
        `${asset.role}: ${brief.creative_direction?.world ?? ""} · "${brief.headline}" · CTA "${brief.cta}"`,
      );
      await admin.from("campaigns").update({ asset_count: created }).eq("id", campaignId);
    }

    report("finalizing", 95);
    await admin
      .from("campaigns")
      .update({
        status: created > 0 ? "generating" : "failed",
        asset_count: created,
        error: created > 0 ? null : "No campaign assets could be composed.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    report("done", 100);
    return { ok: true, assetCount: created };
  } catch (err) {
    return fail(err);
  }
}
