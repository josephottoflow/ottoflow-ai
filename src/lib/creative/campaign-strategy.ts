/**
 * Campaign Strategy Intelligence (Sprint 24).
 *
 * OttoFlow stops thinking about creating a picture and starts thinking like a
 * marketing strategist that happens to generate creatives. The Gemini planner
 * (planCampaignStrategy, in gemini.ts) decides the CAMPAIGN a creative belongs
 * to BEFORE any image is designed. This module is the read-side: Campaign Memory
 * (avoid repeating strategies) + Campaign Intelligence (the dashboard profile +
 * which strategies actually perform), both computed-on-read from the campaign
 * summary persisted on each creative brief (no table, no migration).
 *
 * NOTE (honest scope): this sprint adds the strategist BRAIN — strategy, reasoning
 * and a recommended package PLAN that frames + governs the single creative we
 * generate today, plus campaign memory and a campaign-performance dashboard. The
 * one-click generation of the full multi-asset package and a persisted campaign
 * ENTITY are the deferred follow-on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampaignStrategy } from "@/lib/gemini";
import { normalizeCampaignType } from "@/lib/gemini";
import { clusterKey } from "./brand-intelligence";

/** Compact summary persisted on the brief jsonb (the campaign that framed it). */
export interface CampaignSummary {
  applied: boolean;
  campaign_type: string;
  primary_objective: string;
  secondary_objective: string;
  audience: string;
  awareness_stage: string;
  core_message: string;
  desired_emotion: string;
  primary_cta: string;
  funnel_position: string;
  distribution_strategy: string;
  package: CampaignStrategy["package"];
}

export function campaignSummary(s: CampaignStrategy, applied: boolean): CampaignSummary {
  return {
    applied,
    campaign_type: normalizeCampaignType(s.campaign_type),
    primary_objective: s.primary_objective,
    secondary_objective: s.secondary_objective,
    audience: s.audience,
    awareness_stage: s.awareness_stage,
    core_message: s.core_message,
    desired_emotion: s.desired_emotion,
    primary_cta: s.primary_cta,
    funnel_position: s.funnel_position,
    distribution_strategy: s.distribution_strategy,
    package: s.package,
  };
}

/** Render the CAMPAIGN STRATEGY governing-frame block for the concept prompt. */
export function renderCampaignStrategyBlock(s: CampaignStrategy): string {
  const lines = [
    `CAMPAIGN STRATEGY — this creative is ONE asset in this campaign; reinforce it:`,
    `- Campaign type: ${normalizeCampaignType(s.campaign_type)}`,
    // Campaign Brain (Sprint 25.1): the through-line every asset serves.
    s.narrative ? `- Campaign narrative: ${s.narrative}` : "",
    `- Primary objective: ${s.primary_objective}${s.secondary_objective ? `; Secondary: ${s.secondary_objective}` : ""}`,
    `- Audience: ${s.audience}; Awareness stage: ${s.awareness_stage}`,
    // For a specialized frame this is THIS asset's narrative beat.
    `- This asset advances: ${s.core_message}`,
    `- Desired emotion: ${s.desired_emotion}; CTA (this rung): ${s.primary_cta}`,
    `- Funnel position: ${s.funnel_position}; Distribution: ${s.distribution_strategy}`,
  ].filter(Boolean);
  return lines.join("\n");
}

// ─── Campaign Memory ─────────────────────────────────────────────────────────

/** A reduced past campaign (from a persisted brief.campaign summary). */
interface CampaignRecord {
  campaign_type: string;
  core_message: string;
  primary_cta: string;
  desired_emotion: string;
  audience: string;
  funnel_position: string;
  engagement_rate: number | null;
  created_at: string;
}

function readCampaign(brief: unknown): CampaignSummary | null {
  const c = (brief as { campaign?: CampaignSummary } | null)?.campaign;
  return c && typeof c.campaign_type === "string" ? c : null;
}

/**
 * Campaign Memory recall — compact summaries of this brand's recent campaigns so
 * the strategist evolves (avoid repeating type / message / CTA / emotion).
 */
export async function loadCampaignMemory(
  db: SupabaseClient,
  brandId: string,
): Promise<string[]> {
  try {
    const { data } = await db
      .from("content_creatives")
      .select("creative_brief, created_at")
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false })
      .limit(12);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const row of data ?? []) {
      const c = readCampaign(row.creative_brief);
      if (!c) continue;
      const key = `${c.campaign_type}·${clusterKey(c.core_message)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(
        `${c.campaign_type} → "${(c.core_message || "").slice(0, 80)}" · CTA "${c.primary_cta}" · ${c.desired_emotion}`,
      );
      if (out.length >= 6) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Campaign Brain narrative memory (Sprint 25.1) — recall PAST CAMPAIGNS' whole
 * narratives (not per-creative strategies) so the Brain evolves: avoid repeating
 * the same story / emotional arc / CTA progression / supporting messages. Reads
 * the campaigns table (best-effort; empty before migration 030 is applied).
 */
export async function loadCampaignNarrativeMemory(
  db: SupabaseClient,
  brandId: string,
): Promise<string[]> {
  try {
    const { data } = await db
      .from("campaigns")
      .select("strategy, created_at")
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false })
      .limit(8);
    const out: string[] = [];
    for (const row of data ?? []) {
      const s = (row.strategy ?? null) as
        | { narrative?: string; core_message?: string; emotional_journey?: string[]; cta_progression?: string[]; primary_cta?: string; supporting_stories?: string[] }
        | null;
      if (!s) continue;
      const narrative = s.narrative || s.core_message;
      if (!narrative) continue;
      const arc = (s.emotional_journey ?? []).join(" → ");
      const cta = (s.cta_progression ?? []).join(" → ") || s.primary_cta || "";
      const pillars = (s.supporting_stories ?? []).slice(0, 4).join(", ");
      out.push(
        `"${narrative.slice(0, 90)}" · arc: ${arc || "—"} · CTAs: ${cta || "—"}${pillars ? ` · pillars: ${pillars}` : ""}`,
      );
      if (out.length >= 5) break;
    }
    return out;
  } catch {
    return [];
  }
}

// ─── Campaign Intelligence (dashboard) ───────────────────────────────────────

export interface StrategyMix {
  campaign_type: string;
  count: number;
  /** Avg engagement of measured campaigns of this type (null if none measured). */
  avg_engagement: number | null;
}

export interface CampaignIntelligence {
  brand_id: string;
  total_campaigns: number;
  /** Distinct campaign types / total (0..1). */
  diversity_score: number;
  /** Count by campaign type, most frequent first. */
  strategy_mix: StrategyMix[];
  /** Winning strategies — campaign types ranked by real engagement. */
  winning_strategies: StrategyMix[];
  /** Funnel coverage — count by TOFU/MOFU/BOFU. */
  funnel_coverage: Array<{ stage: string; count: number }>;
  /** Recurring audiences (clustered), most frequent first. */
  audience_trends: Array<{ audience: string; count: number }>;
  /** Recent campaigns timeline (newest first). */
  recent: Array<{ campaign_type: string; core_message: string; funnel_position: string; created_at: string }>;
  generated_at: string;
}

export async function loadCampaignIntelligence(
  db: SupabaseClient,
  brandId: string,
): Promise<CampaignIntelligence> {
  const now = new Date().toISOString();
  const empty: CampaignIntelligence = {
    brand_id: brandId,
    total_campaigns: 0,
    diversity_score: 1,
    strategy_mix: [],
    winning_strategies: [],
    funnel_coverage: [],
    audience_trends: [],
    recent: [],
    generated_at: now,
  };
  try {
    const [{ data: creatives }, { data: metrics }] = await Promise.all([
      db
        .from("content_creatives")
        .select("content_item_id, creative_brief, created_at")
        .eq("brand_id", brandId)
        .order("created_at", { ascending: false })
        .limit(300),
      db.from("content_latest_metrics").select("content_item_id, engagement_rate"),
    ]);
    const erByItem = new Map(
      ((metrics ?? []) as Array<Record<string, unknown>>).map((m) => [
        m.content_item_id as string,
        m.engagement_rate != null ? Number(m.engagement_rate) : null,
      ]),
    );

    const records: CampaignRecord[] = [];
    for (const row of creatives ?? []) {
      const c = readCampaign(row.creative_brief);
      if (!c) continue;
      records.push({
        campaign_type: normalizeCampaignType(c.campaign_type),
        core_message: c.core_message || "",
        primary_cta: c.primary_cta || "",
        desired_emotion: c.desired_emotion || "",
        audience: c.audience || "",
        funnel_position: (c.funnel_position || "").toUpperCase(),
        engagement_rate: erByItem.get(row.content_item_id as string) ?? null,
        created_at: (row.created_at as string) ?? now,
      });
    }
    if (records.length === 0) return empty;

    // Strategy mix + winning strategies (by engagement).
    const byType = new Map<string, { count: number; ers: number[] }>();
    for (const r of records) {
      const g = byType.get(r.campaign_type) ?? { count: 0, ers: [] };
      g.count += 1;
      if (r.engagement_rate != null) g.ers.push(r.engagement_rate);
      byType.set(r.campaign_type, g);
    }
    const strategy_mix: StrategyMix[] = [...byType.entries()]
      .map(([campaign_type, g]) => ({
        campaign_type,
        count: g.count,
        avg_engagement: g.ers.length ? Math.round((g.ers.reduce((s, v) => s + v, 0) / g.ers.length) * 1000) / 1000 : null,
      }))
      .sort((a, b) => b.count - a.count);
    const winning_strategies = strategy_mix
      .filter((s) => s.avg_engagement != null)
      .sort((a, b) => (b.avg_engagement as number) - (a.avg_engagement as number));

    // Funnel coverage.
    const funnel = new Map<string, number>();
    for (const r of records) {
      const stage = ["TOFU", "MOFU", "BOFU"].includes(r.funnel_position) ? r.funnel_position : "OTHER";
      funnel.set(stage, (funnel.get(stage) ?? 0) + 1);
    }
    const order = ["TOFU", "MOFU", "BOFU", "OTHER"];
    const funnel_coverage = [...funnel.entries()]
      .map(([stage, count]) => ({ stage, count }))
      .sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));

    // Audience trends (clustered).
    const aud = new Map<string, { count: number; label: string }>();
    for (const r of records) {
      const key = clusterKey(r.audience);
      if (!key) continue;
      const e = aud.get(key) ?? { count: 0, label: r.audience };
      e.count += 1;
      aud.set(key, e);
    }
    const audience_trends = [...aud.values()]
      .map((e) => ({ audience: e.label, count: e.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const recent = records.slice(0, 8).map((r) => ({
      campaign_type: r.campaign_type,
      core_message: r.core_message,
      funnel_position: r.funnel_position,
      created_at: r.created_at,
    }));

    return {
      brand_id: brandId,
      total_campaigns: records.length,
      diversity_score: Math.round((byType.size / records.length) * 100) / 100,
      strategy_mix,
      winning_strategies,
      funnel_coverage,
      audience_trends,
      recent,
      generated_at: now,
    };
  } catch {
    return empty;
  }
}
