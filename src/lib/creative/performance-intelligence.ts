/**
 * Performance Intelligence Engine (Sprint 23).
 *
 * Sprint 22 taught OttoFlow to learn from AI REVIEW scores ("which image looked
 * best?"). This learns from REAL audience behavior ("which creative actually
 * performed best?"). Real customer engagement OUTRANKS the internal review score.
 *
 * Computed-on-read (no migration): performance already lives in `content_metrics`
 * / `content_latest_metrics` (migration 016) keyed by content_item, and each
 * delivered `content_creatives` row carries that item's creative_direction
 * (Sprint 19) + review score (Sprint 20). We join them and attribute each post's
 * engagement_rate to the dimension values (world / lighting / lens / ...) it used.
 *
 * Source-agnostic: metrics are whatever landed in content_metrics — manual entry
 * today (source='manual'), platform APIs later (source='linkedin_api'/…) with
 * ZERO change here. Real platform-API ingestion (OAuth) is operator-gated and
 * out of this engine's scope; the moment real metrics arrive, the loop closes.
 *
 * Feedback weighting (the spec): recent campaigns weigh most (exponential decay,
 * PERF_HALFLIFE_DAYS, default 30); high engagement surfaces as positive lift,
 * low engagement as negative lift (losing patterns); old campaigns decay out.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { clusterKey } from "./brand-intelligence";

const PERF_DIMS = [
  "world",
  "environment",
  "lighting",
  "lens",
  "composition",
  "mood",
  "color_grade",
  "emotional_tone",
] as const;
export type PerfDim = (typeof PERF_DIMS)[number];

export interface DimPerf {
  value: string;
  /** % lift vs the brand's baseline engagement (can be negative). */
  lift: number;
  /** Recency-weighted mean engagement rate for this value. */
  engagement: number;
  /** Measured posts that used this value. */
  count: number;
}

export interface PlatformPerf {
  platform: string;
  avg_engagement: number;
  count: number;
  top_world: string | null;
}

export interface PerfTimelinePoint {
  date: string; // ISO day
  engagement: number;
  review_score: number | null;
}

export interface PerformanceIntelligence {
  brand_id: string;
  industry: string | null;
  /** Posts with a real engagement signal we learned from. */
  measured_count: number;
  /** Recency-weighted mean engagement rate across measured posts (the baseline). */
  baseline_engagement: number;
  /** 0..1 — how much to trust these signals (grows with measured sample). */
  learning_confidence: number;
  /** Top performers per dimension (highest lift first). */
  top: Record<PerfDim, DimPerf[]>;
  /** Human-readable winning patterns ("editorial corporate +18% engagement"). */
  winning_patterns: string[];
  /** Human-readable losing patterns ("golden-hour offices -15%"). */
  losing_patterns: string[];
  /** Correlation between AI review score and real engagement (−1..1, null if n<4). */
  perf_vs_review: number | null;
  platform_breakdown: PlatformPerf[];
  timeline: PerfTimelinePoint[];
  /** Internal-only "chosen because" bullets grounded in real %s. */
  rationale: string[];
  generated_at: string;
}

/** One delivered + measured creative, reduced to what learning needs. */
export interface PerfSource {
  direction: Record<string, string> | null;
  engagement_rate: number | null;
  review_score: number | null;
  platform: string;
  /** When the metric was captured (recency); falls back to created_at. */
  measured_at: string | null;
  created_at: string;
}

function halfLifeDays(): number {
  const n = Number(process.env.PERF_HALFLIFE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/** Exponential recency decay weight in [~0, 1]. */
function recencyWeight(dateIso: string, halfLife: number): number {
  const t = Date.parse(dateIso);
  if (!Number.isFinite(t)) return 0.5;
  const ageDays = Math.max(0, (Date.now() - t) / 86_400_000);
  return Math.pow(0.5, ageDays / halfLife);
}

interface WCluster {
  wSum: number; // sum of weights
  weSum: number; // sum of weight*engagement
  count: number;
  labels: Map<string, number>;
}

function topLabel(c: WCluster): string {
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

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 4) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return Math.round((num / Math.sqrt(dx * dy)) * 100) / 100;
}

/**
 * Pure compute: turn a brand's measured creatives into a Performance
 * Intelligence profile. Caller fetches + joins the rows.
 */
export function computePerformanceIntelligence(
  brandId: string,
  industry: string | null,
  rows: PerfSource[],
): PerformanceIntelligence {
  const now = new Date().toISOString();
  const HL = halfLifeDays();

  const measured = rows.filter((r) => typeof r.engagement_rate === "number");
  const measuredCount = measured.length;

  // Recency-weighted baseline engagement.
  let wSum = 0;
  let weSum = 0;
  for (const r of measured) {
    const w = recencyWeight(r.measured_at ?? r.created_at, HL);
    wSum += w;
    weSum += w * (r.engagement_rate as number);
  }
  const baseline = wSum > 0 ? weSum / wSum : 0;

  // Per-dimension weighted engagement → lift vs baseline.
  const top = {} as Record<PerfDim, DimPerf[]>;
  const allClusters: Array<{ dim: PerfDim; label: string; lift: number; engagement: number; count: number }> = [];
  for (const dim of PERF_DIMS) {
    const clusters = new Map<string, WCluster>();
    for (const r of measured) {
      const raw = (r.direction?.[dim] ?? "").trim();
      if (!raw) continue;
      const key = clusterKey(raw);
      if (!key) continue;
      const w = recencyWeight(r.measured_at ?? r.created_at, HL);
      let c = clusters.get(key);
      if (!c) {
        c = { wSum: 0, weSum: 0, count: 0, labels: new Map() };
        clusters.set(key, c);
      }
      c.wSum += w;
      c.weSum += w * (r.engagement_rate as number);
      c.count += 1;
      c.labels.set(raw, (c.labels.get(raw) ?? 0) + 1);
    }
    const stats: DimPerf[] = [...clusters.values()]
      .filter((c) => c.wSum > 0)
      .map((c) => {
        const eng = c.weSum / c.wSum;
        const lift = baseline > 0 ? Math.round(((eng - baseline) / baseline) * 100) : 0;
        return { value: topLabel(c), lift, engagement: Math.round(eng * 1000) / 1000, count: c.count };
      })
      .sort((a, b) => b.lift - a.lift || b.count - a.count);
    top[dim] = stats.slice(0, 3);
    for (const s of stats) allClusters.push({ dim, label: s.value, lift: s.lift, engagement: s.engagement, count: s.count });
  }

  // Winning / losing patterns — strongest movers with at least 2 samples.
  const dimLabel: Record<PerfDim, string> = {
    world: "worlds", environment: "environments", lighting: "lighting", lens: "lenses",
    composition: "compositions", mood: "moods", color_grade: "color grades", emotional_tone: "emotional tones",
  };
  const movers = allClusters.filter((c) => c.count >= 2);
  const winning_patterns = movers
    .filter((c) => c.lift >= 8)
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 5)
    .map((c) => `${c.label} (${dimLabel[c.dim]}) +${c.lift}% engagement`);
  const losing_patterns = movers
    .filter((c) => c.lift <= -8)
    .sort((a, b) => a.lift - b.lift)
    .slice(0, 5)
    .map((c) => `${c.label} (${dimLabel[c.dim]}) ${c.lift}% engagement`);

  // Performance vs review score correlation.
  const both = measured.filter((r) => typeof r.review_score === "number");
  const perfVsReview = pearson(
    both.map((r) => r.review_score as number),
    both.map((r) => r.engagement_rate as number),
  );

  // Platform breakdown.
  const platforms = new Map<string, { wSum: number; weSum: number; count: number; worlds: Map<string, WCluster> }>();
  for (const r of measured) {
    const p = r.platform || "unknown";
    const w = recencyWeight(r.measured_at ?? r.created_at, HL);
    let g = platforms.get(p);
    if (!g) {
      g = { wSum: 0, weSum: 0, count: 0, worlds: new Map() };
      platforms.set(p, g);
    }
    g.wSum += w;
    g.weSum += w * (r.engagement_rate as number);
    g.count += 1;
    const raw = (r.direction?.world ?? "").trim();
    const key = raw ? clusterKey(raw) : "";
    if (key) {
      let wc = g.worlds.get(key);
      if (!wc) {
        wc = { wSum: 0, weSum: 0, count: 0, labels: new Map() };
        g.worlds.set(key, wc);
      }
      wc.wSum += w;
      wc.weSum += w * (r.engagement_rate as number);
      wc.count += 1;
      wc.labels.set(raw, (wc.labels.get(raw) ?? 0) + 1);
    }
  }
  const platform_breakdown: PlatformPerf[] = [...platforms.entries()]
    .map(([platform, g]) => {
      const topWorld = [...g.worlds.values()].sort((a, b) => b.weSum / b.wSum - a.weSum / a.wSum)[0];
      return {
        platform,
        avg_engagement: g.wSum > 0 ? Math.round((g.weSum / g.wSum) * 1000) / 1000 : 0,
        count: g.count,
        top_world: topWorld ? topLabel(topWorld) : null,
      };
    })
    .sort((a, b) => b.avg_engagement - a.avg_engagement);

  // Timeline (chronological), last 14 measured posts.
  const timeline: PerfTimelinePoint[] = [...measured]
    .sort((a, b) => Date.parse(a.measured_at ?? a.created_at) - Date.parse(b.measured_at ?? b.created_at))
    .slice(-14)
    .map((r) => ({
      date: (r.measured_at ?? r.created_at).slice(0, 10),
      engagement: Math.round((r.engagement_rate as number) * 1000) / 1000,
      review_score: typeof r.review_score === "number" ? r.review_score : null,
    }));

  // Learning confidence — grows with measured sample (full trust ≈ 12 posts).
  const learningConfidence = Math.round(Math.min(1, measuredCount / 12) * 100) / 100;

  // ── "Declining recently" detection for the single most-used world. ─────────
  const worldRecency = new Map<string, { recent: number[]; older: number[]; label: string }>();
  const sortedByDate = [...measured].sort(
    (a, b) => Date.parse(b.measured_at ?? b.created_at) - Date.parse(a.measured_at ?? a.created_at),
  );
  sortedByDate.forEach((r, idx) => {
    const raw = (r.direction?.world ?? "").trim();
    const key = raw ? clusterKey(raw) : "";
    if (!key) return;
    const e = worldRecency.get(key) ?? { recent: [], older: [], label: raw };
    (idx < Math.ceil(sortedByDate.length / 2) ? e.recent : e.older).push(r.engagement_rate as number);
    worldRecency.set(key, e);
  });
  let declining: string | null = null;
  for (const { recent, older, label } of worldRecency.values()) {
    if (recent.length >= 2 && older.length >= 2) {
      const rm = recent.reduce((s, v) => s + v, 0) / recent.length;
      const om = older.reduce((s, v) => s + v, 0) / older.length;
      if (rm < om * 0.85) {
        declining = label;
        break;
      }
    }
  }

  // ── Explainability (internal). ─────────────────────────────────────────────
  const rationale: string[] = [];
  if (measuredCount < 3) {
    rationale.push(
      `Only ${measuredCount} measured post${measuredCount === 1 ? "" : "s"} — performance learning is still warming up; relying on review-score intelligence for now.`,
    );
  } else {
    for (const p of winning_patterns.slice(0, 3)) rationale.push(`${p} — leaning into it.`);
    for (const p of losing_patterns.slice(0, 1)) rationale.push(`${p} — de-prioritising.`);
    if (declining) rationale.push(`"${declining}" worlds are declining in recent performance — rotating away.`);
    if (perfVsReview != null) {
      rationale.push(
        perfVsReview >= 0.4
          ? `High review scores track real engagement here (r=${perfVsReview}) — review + performance agree.`
          : perfVsReview <= -0.1
            ? `Review score does NOT predict engagement here (r=${perfVsReview}) — trusting real behavior over AI opinion.`
            : `Weak link between review score and engagement (r=${perfVsReview}) — weighting real behavior higher.`,
      );
    }
  }

  return {
    brand_id: brandId,
    industry,
    measured_count: measuredCount,
    baseline_engagement: Math.round(baseline * 1000) / 1000,
    learning_confidence: learningConfidence,
    top,
    winning_patterns,
    losing_patterns,
    perf_vs_review: perfVsReview,
    platform_breakdown,
    timeline,
    rationale,
    generated_at: now,
  };
}

/**
 * Load + compute a brand's Performance Intelligence. Joins delivered creatives
 * (creative_direction + review score) to the latest engagement metric per item.
 * Best-effort: returns an empty profile on error. Works with admin or RLS client.
 */
export async function loadPerformanceIntelligence(
  db: SupabaseClient,
  brandId: string,
  industry: string | null,
): Promise<PerformanceIntelligence> {
  try {
    const [{ data: creatives }, { data: metrics }] = await Promise.all([
      db
        .from("content_creatives")
        .select("content_item_id, platform, creative_brief, created_at")
        .eq("brand_id", brandId)
        .eq("status", "ready")
        .order("created_at", { ascending: false })
        .limit(500),
      db
        .from("content_latest_metrics")
        .select("content_item_id, engagement_rate, captured_at"),
    ]);

    const metricByItem = new Map(
      ((metrics ?? []) as Array<Record<string, unknown>>).map((m) => [
        m.content_item_id as string,
        {
          engagement_rate: m.engagement_rate != null ? Number(m.engagement_rate) : null,
          captured_at: (m.captured_at as string | null) ?? null,
        },
      ]),
    );

    // Latest delivered creative per item (newest-first → first-seen wins),
    // joined to its measured engagement.
    const seen = new Set<string>();
    const rows: PerfSource[] = [];
    for (const c of creatives ?? []) {
      const itemId = c.content_item_id as string;
      if (!itemId || seen.has(itemId)) continue;
      seen.add(itemId);
      const metric = metricByItem.get(itemId);
      if (!metric || metric.engagement_rate == null) continue; // only measured posts
      const brief = (c.creative_brief ?? {}) as {
        creative_direction?: Record<string, string>;
        review?: { overall_score?: number };
      };
      rows.push({
        direction: brief.creative_direction ?? null,
        engagement_rate: metric.engagement_rate,
        review_score: typeof brief.review?.overall_score === "number" ? brief.review.overall_score : null,
        platform: (c.platform as string) ?? "unknown",
        measured_at: metric.captured_at,
        created_at: (c.created_at as string) ?? new Date().toISOString(),
      });
    }
    return computePerformanceIntelligence(brandId, industry, rows);
  } catch {
    return computePerformanceIntelligence(brandId, industry, []);
  }
}

/** Compact summary persisted on the brief jsonb (internal explainability). */
export interface PerformanceSummary {
  applied: boolean;
  measured_count: number;
  baseline_engagement: number;
  learning_confidence: number;
  winning_patterns: string[];
  losing_patterns: string[];
  rationale: string[];
}

export function performanceSummary(pi: PerformanceIntelligence, applied: boolean): PerformanceSummary {
  return {
    applied,
    measured_count: pi.measured_count,
    baseline_engagement: pi.baseline_engagement,
    learning_confidence: pi.learning_confidence,
    winning_patterns: pi.winning_patterns,
    losing_patterns: pi.losing_patterns,
    rationale: pi.rationale,
  };
}

/**
 * Render the PERFORMANCE INTELLIGENCE block for the concept prompt (priority #3,
 * ABOVE Brand Intelligence). Returns "" when there's no real engagement data yet
 * (the loop falls back to review-score intelligence).
 */
export function renderPerformanceBlock(pi: PerformanceIntelligence): string {
  if (pi.measured_count < 1) return "";

  const lines: string[] = [];
  lines.push(
    `PERFORMANCE INTELLIGENCE — REAL audience behavior for THIS brand, learned from ${pi.measured_count} measured campaign${pi.measured_count === 1 ? "" : "s"} (weighted to recent + high-engagement; this OUTRANKS the AI review score):`,
  );
  if (pi.winning_patterns.length) lines.push(`- WINNING patterns (lift vs baseline) — lean in: ${pi.winning_patterns.join("; ")}`);
  if (pi.losing_patterns.length) lines.push(`- LOSING patterns — avoid / de-prioritise: ${pi.losing_patterns.join("; ")}`);

  const dimLine = (label: string, stats: DimPerf[]) => {
    const strong = stats.filter((s) => s.lift > 0);
    if (!strong.length) return;
    lines.push(`- Top ${label} by real engagement: ${strong.map((s) => `${s.value} (+${s.lift}%${s.count > 1 ? `, n=${s.count}` : ""})`).join("; ")}`);
  };
  dimLine("worlds", pi.top.world);
  dimLine("lighting", pi.top.lighting);
  dimLine("mood", pi.top.mood);
  dimLine("lens", pi.top.lens);

  if (pi.platform_breakdown.length > 1) {
    lines.push(
      `- Platform differences: ${pi.platform_breakdown.map((p) => `${p.platform} eng ${p.avg_engagement}${p.top_world ? ` (best: ${p.top_world})` : ""}`).join("; ")}`,
    );
  }
  lines.push(
    `Optimise for what REAL customers do, not how the image looks. When performance and review score disagree, FOLLOW THE PERFORMANCE. Keep the brand recognizable while pushing toward the winning patterns.`,
  );
  return lines.join("\n");
}
