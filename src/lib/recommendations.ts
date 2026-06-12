/**
 * Optimization Recommendations v1 — a PURE rule engine over performance
 * aggregates. No AI calls, no storage: recommendations are recomputed from
 * current data on every read, so API-ingested metrics later sharpen them
 * automatically (the aggregates are the contract, not this code).
 *
 * Honesty rules:
 *  - every recommendation explains itself: why + metrics + content examples
 *  - minimum-sample guards per rule; thin data is labeled "early signal"
 *  - silence is a valid output — no padding when data doesn't support advice
 */
import type { ContentPerformanceData, PerfGroup, PerfItem } from "./db";

export interface LensInventoryRow {
  kind: string;
  total: number;
  used: number;
  unused: number;
  /** Up to 3 unused idea titles, for the "underused lens" examples. */
  unusedSamples: string[];
}

export interface RecMetric {
  label: string;
  value: string;
}

export interface RecExample {
  title: string;
  er: number | null;
}

export interface Recommendation {
  id: string;
  kind: "topic" | "lens" | "evidence" | "platform" | "hygiene";
  action: string;       // imperative headline
  why: string;          // plain-language reasoning
  metrics: RecMetric[];
  examples: RecExample[];
  earlySignal: boolean; // n too small to be more than a hint
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

function overallAvgER(items: PerfItem[]): number | null {
  const ers = items.map((i) => i.engagementRate).filter((e): e is number => e != null);
  if (ers.length === 0) return null;
  return ers.reduce((a, b) => a + b, 0) / ers.length;
}

function examplesFor(items: PerfItem[], filter: (i: PerfItem) => boolean, n = 2): RecExample[] {
  return items
    .filter(filter)
    .filter((i) => i.engagementRate != null)
    .sort((a, b) => b.engagementRate! - a.engagementRate!)
    .slice(0, n)
    .map((i) => ({ title: i.title, er: i.engagementRate }));
}

export function generateRecommendations(
  perf: ContentPerformanceData,
  lensInventory: LensInventoryRow[],
): Recommendation[] {
  const recs: Recommendation[] = [];
  const avg = overallAvgER(perf.items);
  const measured = perf.items.filter((i) => i.engagementRate != null);
  const small = measured.length < 3; // global early-signal flag

  // ── 1. Topic momentum: create more of what works ──────────────────────────
  if (avg != null) {
    for (const t of perf.byTopic) {
      if (t.avgER == null || t.withMetrics < 1) continue;
      if (t.avgER >= avg * 1.15 && t.avgER > 0) {
        recs.push({
          id: `topic-up:${t.key}`,
          kind: "topic",
          action: `Create more content about “${t.key}”`,
          why: `This topic averages ${pct(t.avgER)} engagement vs ${pct(avg)} across all measured posts (${Math.round((t.avgER / avg - 1) * 100)}% above average).`,
          metrics: [
            { label: "Topic avg ER", value: pct(t.avgER) },
            { label: "Overall avg ER", value: pct(avg) },
            { label: "Posts measured", value: String(t.withMetrics) },
          ],
          examples: examplesFor(perf.items, (i) => i.topicTitle === t.key),
          earlySignal: small || t.withMetrics < 3,
        });
      }
      // ── 2. Topic drag: reduce repeated underperformers ────────────────────
      if (t.avgER <= avg * 0.6 && t.withMetrics >= 2) {
        recs.push({
          id: `topic-down:${t.key}`,
          kind: "topic",
          action: `Rework or reduce content about “${t.key}”`,
          why: `${t.withMetrics} measured posts on this topic average ${pct(t.avgER)} — ${Math.round((1 - t.avgER / avg) * 100)}% below your ${pct(avg)} overall average. Try a different angle before publishing more of it.`,
          metrics: [
            { label: "Topic avg ER", value: pct(t.avgER) },
            { label: "Overall avg ER", value: pct(avg) },
            { label: "Posts measured", value: String(t.withMetrics) },
          ],
          examples: examplesFor(perf.items, (i) => i.topicTitle === t.key),
          earlySignal: t.withMetrics < 3,
        });
      }
    }
  }

  // ── 3. Lens comparison: which detection lens earns attention ─────────────
  const lensesWithData = perf.byLens.filter((l) => l.avgER != null && l.withMetrics >= 1);
  if (lensesWithData.length >= 2) {
    const [best, ...rest] = lensesWithData;
    const runnerUp = rest[0];
    if (best.avgER! > runnerUp.avgER! * 1.2) {
      recs.push({
        id: `lens-best:${best.key}`,
        kind: "lens",
        action: `Use more ${best.key.replace("_", "-")} opportunities`,
        why: `Posts from ${best.key.replace("_", "-")} opportunities average ${pct(best.avgER!)} vs ${pct(runnerUp.avgER!)} for ${runnerUp.key.replace("_", "-")} — your strongest lens so far.`,
        metrics: [
          { label: `${best.key} avg ER`, value: pct(best.avgER!) },
          { label: `${runnerUp.key} avg ER`, value: pct(runnerUp.avgER!) },
          { label: "Posts measured", value: String(best.withMetrics) },
        ],
        examples: examplesFor(perf.items, (i) => i.opportunityKind === best.key),
        earlySignal: best.withMetrics < 3,
      });
    }
  }

  // ── 4. Underused high-performing lenses ───────────────────────────────────
  if (avg != null) {
    for (const lens of lensesWithData) {
      if (lens.avgER! < avg) continue;
      const inv = lensInventory.find((l) => l.kind === lens.key);
      if (!inv || inv.unused === 0) continue;
      recs.push({
        id: `lens-unused:${lens.key}`,
        kind: "lens",
        action: `You have ${inv.unused} unused ${lens.key.replace("_", "-")} ideas — your best-performing lens`,
        why: `${lens.key.replace("_", "-")} posts average ${pct(lens.avgER!)} (at or above your ${pct(avg)} overall average), and ${inv.unused} of ${inv.total} mined ${lens.key.replace("_", "-")} opportunities are still unused in the idea pool.`,
        metrics: [
          { label: "Lens avg ER", value: pct(lens.avgER!) },
          { label: "Unused ideas", value: `${inv.unused} of ${inv.total}` },
        ],
        examples: inv.unusedSamples.map((title) => ({ title, er: null })),
        earlySignal: lens.withMetrics < 3,
      });
    }
  }

  // ── 5. Evidence domains: best and worst grounding sources ────────────────
  if (avg != null) {
    const domains = perf.byEvidenceDomain.filter((d) => d.avgER != null && d.withMetrics >= 1);
    const top = domains.filter((d) => d.avgER! >= avg).slice(0, 3);
    if (top.length > 0) {
      recs.push({
        id: "evidence-top",
        kind: "evidence",
        action: `Prioritize research from ${top.map((d) => d.key).join(", ")}`,
        why: `Content grounded in ${top.length === 1 ? "this source" : "these sources"} performs at or above your ${pct(avg)} average — they're producing your most engaging claims.`,
        metrics: top.map((d) => ({ label: d.key, value: `${pct(d.avgER!)} avg ER` })),
        examples: examplesFor(perf.items, () => true, 2),
        earlySignal: small,
      });
    }
    const bottom = domains.filter((d) => d.avgER! <= avg * 0.6 && d.withMetrics >= 2).slice(0, 3);
    if (bottom.length > 0) {
      recs.push({
        id: "evidence-bottom",
        kind: "evidence",
        action: `Deprioritize evidence from ${bottom.map((d) => d.key).join(", ")}`,
        why: `Content grounded in ${bottom.length === 1 ? "this source" : "these sources"} consistently underperforms (≤60% of your average engagement across ≥2 posts).`,
        metrics: bottom.map((d) => ({ label: d.key, value: `${pct(d.avgER!)} avg ER` })),
        examples: [],
        earlySignal: false,
      });
    }
  }

  // ── 6. Platform comparison ─────────────────────────────────────────────────
  const platforms = perf.byPlatform.filter((p) => p.avgER != null && p.withMetrics >= 1);
  if (platforms.length >= 2) {
    const [bestP, ...restP] = platforms;
    const second = restP[0];
    if (bestP.avgER! > second.avgER! * 1.25) {
      recs.push({
        id: `platform-best:${bestP.key}`,
        kind: "platform",
        action: `Shift more output to ${bestP.key}`,
        why: `${bestP.key} averages ${pct(bestP.avgER!)} engagement vs ${pct(second.avgER!)} on ${second.key}.`,
        metrics: [
          { label: `${bestP.key} avg ER`, value: pct(bestP.avgER!) },
          { label: `${second.key} avg ER`, value: pct(second.avgER!) },
        ],
        examples: examplesFor(perf.items, (i) => i.platform === bestP.key),
        earlySignal: bestP.withMetrics < 3,
      });
    }
  }

  // ── 7. Metrics coverage (the data flywheel) ───────────────────────────────
  const unmeasured = perf.items.filter((i) => i.engagementRate == null && i.impressions == null);
  if (unmeasured.length > 0) {
    recs.push({
      id: "hygiene-coverage",
      kind: "hygiene",
      action: `Record metrics for ${unmeasured.length} published ${unmeasured.length === 1 ? "post" : "posts"}`,
      why: "Every recommendation above sharpens with more measured posts — these published posts have no metrics yet, so they contribute nothing to topic, lens, or evidence rankings.",
      metrics: [
        { label: "Published without metrics", value: String(unmeasured.length) },
        { label: "Published with metrics", value: String(measured.length) },
      ],
      examples: unmeasured.slice(0, 3).map((i) => ({ title: i.title, er: null })),
      earlySignal: false,
    });
  }

  // Stable ordering: actionable growth first, hygiene last.
  const order: Record<Recommendation["kind"], number> = {
    topic: 0,
    lens: 1,
    evidence: 2,
    platform: 3,
    hygiene: 4,
  };
  return recs.sort((a, b) => order[a.kind] - order[b.kind]);
}
