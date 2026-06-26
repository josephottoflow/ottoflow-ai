/**
 * Brand Learning Engine (Sprint 22) — Creative Intelligence.
 *
 * OttoFlow evolves from REMEMBERING previous creatives (Sprint 19) to LEARNING
 * which creative decisions consistently produce the highest-quality work for a
 * brand. Instead of "what did we make before?" it answers "what consistently
 * works best for this brand?".
 *
 * This is computed-on-read from the delivered creatives a brand already has —
 * every `content_creatives` row in 'ready' carries the DELIVERED creative
 * direction (Sprint 19), the AI review score (Sprint 20) and the
 * needs_human_review flag + revision_count (Sprint 21). No new table, no write
 * path, no migration: the profile is always consistent with the source data,
 * and each newly-delivered creative makes the next generation smarter.
 *
 * Learning rules (the spec): NEVER learn from weak creatives. The positive
 * profile (best worlds/lighting/lens/...) is built ONLY from high-scoring,
 * non-flagged, final delivered creatives. Intermediate failed/rejected revision
 * attempts (stored in revision_history) are deliberately ignored. Repetition /
 * overuse is measured across ALL recent deliveries (a SUCCESSFUL world can still
 * be overused — the "boardroom ×20" problem).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { industryConstraint } from "./creative-direction";

const DIM_KEYS = [
  "world",
  "environment",
  "lighting",
  "lens",
  "composition",
  "mood",
  "color_grade",
  "emotional_tone",
] as const;
export type DimKey = (typeof DIM_KEYS)[number];

export interface DimStat {
  /** The most representative full value in this cluster. */
  value: string;
  /** How many learnable creatives used a value in this cluster. */
  count: number;
  /** Mean overall review score for those creatives. */
  avg_score: number;
}

export interface CreativeIntelligence {
  brand_id: string;
  industry: string | null;
  /** High-scoring, non-flagged, final delivered creatives we learned from. */
  sample_size: number;
  /** All reviewed delivered creatives (any score) — denominator for rates. */
  delivered_count: number;
  /** Mean overall score across reviewed deliveries (0 when none). */
  avg_score: number;
  /** Fraction of reviewed deliveries that passed the bar (score≥T, not flagged). */
  pass_rate: number;
  /** Mean self-improvement revisions per delivery. */
  avg_revisions: number;
  /** Variety of worlds in the recent window: unique/total (0..1). */
  diversity_score: number;
  /** Recent-half avg score minus older-half avg score (>0 = improving). */
  improvement_trend: number;
  /** Top performers per dimension (best first). */
  best: Record<DimKey, DimStat[]>;
  /** World values OVERUSED in the recent window — discourage convergence. */
  overused: string[];
  /** Underused-but-valid adjacent worlds to PREFER for variety. */
  explore: string[];
  /** World values that repeatedly score poorly — avoid. */
  avoid: string[];
  /** Internal-only "why this direction was guided" bullets. */
  rationale: string[];
  generated_at: string;
}

/** One delivered creative, reduced to what learning needs. */
export interface LearnSource {
  direction: Record<string, string> | null;
  overall_score: number | null;
  needs_human_review: boolean;
  revision_count: number;
  created_at: string;
}

/** Quality bar (shared with the review engine; override CREATIVE_REVIEW_THRESHOLD). */
function threshold(): number {
  const n = Number(process.env.CREATIVE_REVIEW_THRESHOLD);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 85;
}

const STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "with", "and", "to", "for", "at", "by",
  "from", "into", "over", "under", "near", "amid", "through", "across",
]);

/**
 * Cluster key for a free-text direction value — lowercased, punctuation
 * stripped, stopwords removed, first 3 significant tokens. Clusters near-
 * duplicates ("executive boardroom interior" ≈ "executive boardroom, glass")
 * without heavy NLP.
 */
export function clusterKey(text: string): string {
  const toks = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
  return toks.slice(0, 3).join(" ");
}

interface Cluster {
  scoreSum: number;
  count: number;
  /** full value → frequency, to surface the most representative label. */
  labels: Map<string, number>;
}

function topLabel(c: Cluster): string {
  let best = "";
  let n = -1;
  for (const [label, freq] of c.labels) {
    if (freq > n) {
      n = freq;
      best = label;
    }
  }
  return best;
}

/** Aggregate one dimension over the learnable rows → ranked DimStat[]. */
function bestForDim(rows: LearnSource[], dim: DimKey, limit = 2): DimStat[] {
  const clusters = new Map<string, Cluster>();
  for (const r of rows) {
    const raw = (r.direction?.[dim] ?? "").trim();
    if (!raw) continue;
    const key = clusterKey(raw);
    if (!key) continue;
    let c = clusters.get(key);
    if (!c) {
      c = { scoreSum: 0, count: 0, labels: new Map() };
      clusters.set(key, c);
    }
    c.scoreSum += r.overall_score ?? 0;
    c.count += 1;
    c.labels.set(raw, (c.labels.get(raw) ?? 0) + 1);
  }
  return [...clusters.values()]
    .map((c) => ({ value: topLabel(c), count: c.count, avg_score: Math.round(c.scoreSum / c.count) }))
    // Reward both consistency (count) and quality (avg_score).
    .sort((a, b) => b.avg_score - a.avg_score || b.count - a.count)
    .slice(0, limit);
}

/**
 * Pure compute: turn a brand's delivered creatives into a Creative Intelligence
 * profile. Caller fetches the rows (with its own client) and supplies industry.
 */
export function computeCreativeIntelligence(
  brandId: string,
  industry: string | null,
  rows: LearnSource[],
): CreativeIntelligence {
  const T = threshold();
  const now = new Date().toISOString();

  // Reviewed deliveries (any score) → rates + trend. Newest first in `rows`.
  const reviewed = rows.filter((r) => r.overall_score != null);
  // Learnable = high-scoring, non-flagged final deliveries (NEVER learn weak).
  const learnable = reviewed.filter((r) => (r.overall_score as number) >= T && !r.needs_human_review);

  const deliveredCount = reviewed.length;
  const avgScore = deliveredCount
    ? Math.round(reviewed.reduce((s, r) => s + (r.overall_score as number), 0) / deliveredCount)
    : 0;
  const passRate = deliveredCount ? learnable.length / deliveredCount : 0;
  const avgRevisions = deliveredCount
    ? Math.round((reviewed.reduce((s, r) => s + (r.revision_count ?? 0), 0) / deliveredCount) * 10) / 10
    : 0;

  // Improvement trend — oldest→newest, recent half vs older half.
  const chrono = [...reviewed].reverse(); // oldest first
  let improvementTrend = 0;
  if (chrono.length >= 4) {
    const mid = Math.floor(chrono.length / 2);
    const older = chrono.slice(0, mid);
    const recent = chrono.slice(mid);
    const mean = (xs: LearnSource[]) => xs.reduce((s, r) => s + (r.overall_score as number), 0) / xs.length;
    improvementTrend = Math.round(mean(recent) - mean(older));
  }

  // Best per dimension — from LEARNABLE rows only.
  const best = {} as Record<DimKey, DimStat[]>;
  for (const dim of DIM_KEYS) best[dim] = bestForDim(learnable, dim);

  // ── Diversity + overuse over the recent window (ANY score — a successful
  //    world can still be overused). ────────────────────────────────────────
  const windowRows = rows.slice(0, 8); // newest first
  const windowLen = windowRows.length;
  const worldFreq = new Map<string, { count: number; label: string }>();
  for (const r of windowRows) {
    const raw = (r.direction?.world ?? "").trim();
    if (!raw) continue;
    const key = clusterKey(raw);
    if (!key) continue;
    const e = worldFreq.get(key) ?? { count: 0, label: raw };
    e.count += 1;
    worldFreq.set(key, e);
  }
  const uniqueWorlds = worldFreq.size;
  const diversityScore = windowLen ? Math.round((uniqueWorlds / windowLen) * 100) / 100 : 1;
  const overuseCut = Math.max(3, Math.ceil(windowLen * 0.4));
  const overusedEntries = [...worldFreq.entries()].filter(([, e]) => e.count >= overuseCut);
  const overused = overusedEntries.map(([, e]) => e.label);
  const overusedKeys = new Set(overusedEntries.map(([k]) => k));
  const recentKeys = new Set(worldFreq.keys());

  // Underused-but-valid adjacent worlds (from the industry world range) not seen
  // in the recent window → exploration candidates that keep the brand on-brand.
  const candidateWorlds = industryConstraint(industry)
    .worlds.split(",")
    .map((w) => w.trim())
    .filter(Boolean);
  const explore = candidateWorlds
    .filter((w) => {
      const k = clusterKey(w);
      return k && !recentKeys.has(k) && !overusedKeys.has(k);
    })
    .slice(0, 5);

  // Repeatedly-weak worlds (avg score well below the bar, seen ≥2×).
  const weakWorld = new Map<string, Cluster>();
  for (const r of reviewed) {
    const raw = (r.direction?.world ?? "").trim();
    if (!raw) continue;
    const key = clusterKey(raw);
    if (!key) continue;
    let c = weakWorld.get(key);
    if (!c) {
      c = { scoreSum: 0, count: 0, labels: new Map() };
      weakWorld.set(key, c);
    }
    c.scoreSum += r.overall_score as number;
    c.count += 1;
    c.labels.set(raw, (c.labels.get(raw) ?? 0) + 1);
  }
  const avoid = [...weakWorld.values()]
    .filter((c) => c.count >= 2 && c.scoreSum / c.count < T - 10)
    .sort((a, b) => a.scoreSum / a.count - b.scoreSum / b.count)
    .slice(0, 4)
    .map(topLabel);

  // ── Explainability — internal-only "chosen because" guidance bullets. ──────
  const rationale: string[] = [];
  if (learnable.length < 3) {
    rationale.push(
      `Only ${learnable.length} strong creative${learnable.length === 1 ? "" : "s"} on record — exploring broadly to build this brand's creative intelligence.`,
    );
  } else {
    const w = best.world[0];
    if (w) rationale.push(`Favouring "${w.value}" worlds — they average ${w.avg_score} over ${w.count} creatives.`);
    const li = best.lighting[0];
    if (li) rationale.push(`"${li.value}" lighting performs best here (avg ${li.avg_score}).`);
    const co = best.composition[0];
    if (co) rationale.push(`"${co.value}" compositions outperform the alternatives (avg ${co.avg_score}).`);
  }
  if (overused.length) rationale.push(`Avoiding "${overused[0]}" — overused in the recent window (${overuseCut}+ of last ${windowLen}).`);
  if (explore.length) rationale.push(`Exploring underused but on-brand worlds for variety: ${explore.slice(0, 3).join(", ")}.`);
  if (avoid.length) rationale.push(`Steering clear of "${avoid[0]}" — it has repeatedly scored below the bar.`);

  return {
    brand_id: brandId,
    industry,
    sample_size: learnable.length,
    delivered_count: deliveredCount,
    avg_score: avgScore,
    pass_rate: Math.round(passRate * 100) / 100,
    avg_revisions: avgRevisions,
    diversity_score: diversityScore,
    improvement_trend: improvementTrend,
    best,
    overused,
    explore,
    avoid,
    rationale,
    generated_at: now,
  };
}

/**
 * Load + compute a brand's Creative Intelligence. Works with either the admin
 * client (route/worker) or the RLS server client (dashboard) — both expose the
 * same `.from()` query surface. Best-effort: returns an empty profile on error.
 */
export async function loadCreativeIntelligence(
  db: SupabaseClient,
  brandId: string,
  industry: string | null,
): Promise<CreativeIntelligence> {
  try {
    const { data } = await db
      .from("content_creatives")
      .select("creative_brief, created_at")
      .eq("brand_id", brandId)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(200);
    const rows: LearnSource[] = (data ?? []).map((row) => {
      const brief = (row.creative_brief ?? {}) as {
        creative_direction?: Record<string, string>;
        review?: { overall_score?: number };
        needs_human_review?: boolean;
        revision_count?: number;
      };
      return {
        direction: brief.creative_direction ?? null,
        overall_score: typeof brief.review?.overall_score === "number" ? brief.review.overall_score : null,
        needs_human_review: brief.needs_human_review === true,
        revision_count: typeof brief.revision_count === "number" ? brief.revision_count : 0,
        created_at: (row.created_at as string) ?? new Date().toISOString(),
      };
    });
    return computeCreativeIntelligence(brandId, industry, rows);
  } catch {
    return computeCreativeIntelligence(brandId, industry, []);
  }
}

/** Compact summary persisted on the brief jsonb (internal explainability). */
export interface IntelligenceSummary {
  applied: boolean;
  sample_size: number;
  delivered_count: number;
  avg_score: number;
  pass_rate: number;
  diversity_score: number;
  improvement_trend: number;
  rationale: string[];
  overused: string[];
  explore: string[];
}

export function intelligenceSummary(ci: CreativeIntelligence, applied: boolean): IntelligenceSummary {
  return {
    applied,
    sample_size: ci.sample_size,
    delivered_count: ci.delivered_count,
    avg_score: ci.avg_score,
    pass_rate: ci.pass_rate,
    diversity_score: ci.diversity_score,
    improvement_trend: ci.improvement_trend,
    rationale: ci.rationale,
    overused: ci.overused,
    explore: ci.explore,
  };
}

/**
 * Render the BRAND INTELLIGENCE block for the concept prompt (priority #3).
 * Returns "" when there's nothing learned yet (clean slate — Creative Memory
 * alone handles variety). Encodes diversity protection: keep the brand
 * recognizable while maximizing variety.
 */
export function renderIntelligenceBlock(ci: CreativeIntelligence): string {
  if (ci.delivered_count < 1) return "";

  const lines: string[] = [];
  lines.push(
    `BRAND INTELLIGENCE — what consistently works for THIS brand, learned from ${ci.sample_size} high-scoring delivered creative${ci.sample_size === 1 ? "" : "s"} (informs, NEVER overrides the brief):`,
  );

  const dimLine = (label: string, stats: DimStat[]) => {
    if (!stats.length) return;
    lines.push(`- Best ${label}: ${stats.map((s) => `${s.value} (avg ${s.avg_score}${s.count > 1 ? `, ×${s.count}` : ""})`).join("; ")}`);
  };
  if (ci.sample_size >= 3) {
    dimLine("worlds", ci.best.world);
    dimLine("environments", ci.best.environment);
    dimLine("lighting", ci.best.lighting);
    dimLine("lens", ci.best.lens);
    dimLine("composition", ci.best.composition);
    dimLine("mood", ci.best.mood);
    dimLine("emotional tone", ci.best.emotional_tone);
    dimLine("color grade", ci.best.color_grade);
  } else {
    lines.push(`- Not enough strong history yet to fix preferences — explore widely while staying on-brand.`);
  }

  if (ci.overused.length) {
    lines.push(
      `- OVERUSED recently — do NOT default to these; they cause convergence: ${ci.overused.join("; ")}`,
    );
  }
  if (ci.explore.length) {
    lines.push(
      `- UNDERUSED but valid for this brand — PREFER one of these for variety: ${ci.explore.join("; ")}`,
    );
  }
  if (ci.avoid.length) {
    lines.push(`- AVOID (repeatedly weak): ${ci.avoid.join("; ")}`);
  }
  lines.push(
    `Diversity is a GOAL: keep the brand recognizable (consistent lighting / grade / mood signature) while VARYING the world, environment and composition. A world that has succeeded many times is still overused — rotate to an adjacent world rather than repeating it.`,
  );
  return lines.join("\n");
}
