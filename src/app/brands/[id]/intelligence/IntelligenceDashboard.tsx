/**
 * Creative Intelligence dashboard (Sprint 22) — INTERNAL operations only.
 *
 * A read-only view of what a brand has LEARNED: average review score, pass rate,
 * average revisions, diversity score, improvement trend, the best (and worst)
 * creative worlds + dimensions, and the internal "chosen because" rationale.
 * Pure server component — no customer UI, no interactivity.
 */
import Link from "next/link";
import { ArrowLeft, Lock, Activity, Target } from "lucide-react";
import type { CreativeIntelligence, DimKey, DimStat } from "@/lib/creative/brand-intelligence";
import type { PerformanceIntelligence, DimPerf, PerfDim } from "@/lib/creative/performance-intelligence";
import type { CampaignIntelligence } from "@/lib/creative/campaign-strategy";
import type { DbBrand } from "@/lib/types";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass rounded-2xl p-5">
      <p className="text-3xs font-semibold uppercase tracking-widest text-white/35">{label}</p>
      <p className="mt-2 text-2xl font-bold text-white tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-white/40">{hint}</p>}
    </div>
  );
}

function DimList({ title, stats }: { title: string; stats: DimStat[] }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-3xs font-semibold uppercase tracking-widest text-white/35 mb-2.5">{title}</p>
      {stats.length === 0 ? (
        <p className="text-xs text-white/30">No strong signal yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {stats.map((s, i) => (
            <li key={i} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-white/80 truncate">{s.value}</span>
              <span className="flex-shrink-0 text-xs font-semibold text-emerald-400 tabular-nums">
                {s.avg_score}
                <span className="text-white/30 font-normal">{s.count > 1 ? ` ·×${s.count}` : ""}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chips({ title, items, tone }: { title: string; items: string[]; tone: "warn" | "good" | "bad" }) {
  if (!items.length) return null;
  const toneCls =
    tone === "warn"
      ? "bg-amber-500/[0.08] border-amber-500/20 text-amber-300"
      : tone === "good"
        ? "bg-emerald-500/[0.08] border-emerald-500/20 text-emerald-300"
        : "bg-rose-500/[0.08] border-rose-500/20 text-rose-300";
  return (
    <div>
      <p className="text-3xs font-semibold uppercase tracking-widest text-white/35 mb-2">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <span key={i} className={`text-xs px-2.5 py-1 rounded-full border ${toneCls}`}>
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

function PerfDimList({ title, stats }: { title: string; stats: DimPerf[] }) {
  const strong = stats.filter((s) => s.lift !== 0);
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-3xs font-semibold uppercase tracking-widest text-white/35 mb-2.5">{title}</p>
      {strong.length === 0 ? (
        <p className="text-xs text-white/30">No measured signal yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {strong.map((s, i) => (
            <li key={i} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-white/80 truncate">{s.value}</span>
              <span
                className={`flex-shrink-0 text-xs font-semibold tabular-nums ${s.lift >= 0 ? "text-emerald-400" : "text-rose-400"}`}
              >
                {s.lift >= 0 ? "+" : ""}
                {s.lift}%<span className="text-white/30 font-normal">{s.count > 1 ? ` ·n=${s.count}` : ""}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Minimal engagement sparkline (recency left→right). */
function Sparkline({ pts }: { pts: PerformanceIntelligence["timeline"] }) {
  if (pts.length < 2) return null;
  const vals = pts.map((p) => p.engagement);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const span = max - min || 1;
  return (
    <div className="flex items-end gap-1 h-16">
      {pts.map((p, i) => {
        const h = 12 + ((p.engagement - min) / span) * 44;
        return (
          <div
            key={i}
            className="flex-1 rounded-t bg-gradient-to-t from-[#E9863B]/40 to-[#F2A863]/80"
            style={{ height: `${h}px` }}
            title={`${p.date}: eng ${p.engagement}${p.review_score != null ? ` · review ${p.review_score}` : ""}`}
          />
        );
      })}
    </div>
  );
}

const PERF_DIM_LABELS: Partial<Record<PerfDim, string>> = {
  world: "Top performing worlds",
  lighting: "Top performing lighting",
  mood: "Top performing mood",
  lens: "Top performing lens",
};

const DIM_LABELS: Record<DimKey, string> = {
  world: "Best worlds",
  environment: "Best environments",
  lighting: "Best lighting",
  lens: "Best lenses",
  composition: "Best compositions",
  mood: "Best moods",
  color_grade: "Best color grade",
  emotional_tone: "Best emotional tones",
};

function fmtType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function IntelligenceDashboard({
  brand,
  ci,
  pi,
  campaign,
}: {
  brand: DbBrand;
  ci: CreativeIntelligence;
  pi: PerformanceIntelligence;
  campaign: CampaignIntelligence;
}) {
  const trend = ci.improvement_trend;
  const trendStr = trend > 0 ? `+${trend}` : `${trend}`;
  const empty = ci.delivered_count < 1;
  const hasPerf = pi.measured_count > 0;
  const hasCampaigns = campaign.total_campaigns > 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 lg:px-8">
      <Link
        href={`/brands/${brand.id}`}
        className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors mb-4"
      >
        <ArrowLeft size={13} /> Back to {brand.name}
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Creative Intelligence</h1>
          <p className="text-sm text-white/45 mt-0.5">
            What consistently works best for {brand.name}
            {brand.industry ? ` · ${brand.industry}` : ""}.
          </p>
        </div>
        <span className="flex-shrink-0 inline-flex items-center gap-1.5 text-3xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 text-white/40">
          <Lock size={11} /> Internal · Ops only
        </span>
      </div>

      {empty ? (
        <div className="glass rounded-2xl p-10 text-center">
          <p className="text-white/70 font-medium">No delivered creatives yet.</p>
          <p className="text-sm text-white/40 mt-1.5 max-w-md mx-auto">
            This brand learns as you generate, review and deliver creatives. Each high-scoring delivery
            sharpens future generations — best worlds, lighting and compositions surface here, and overused
            worlds get rotated out automatically.
          </p>
        </div>
      ) : (
        <>
          {/* ── Campaign Intelligence (Sprint 24) — strategy governs everything. ── */}
          <div className="flex items-center gap-2 mb-3">
            <Target size={15} className="text-[#F2A863]" />
            <h2 className="text-sm font-semibold text-white/85">Campaign Intelligence</h2>
            <span className="text-3xs uppercase tracking-wider text-white/30">marketing strategy</span>
          </div>

          {!hasCampaigns ? (
            <div className="glass rounded-2xl p-6 text-center mb-8">
              <p className="text-white/65 text-sm font-medium">No campaigns planned yet.</p>
              <p className="text-xs text-white/40 mt-1.5 max-w-lg mx-auto">
                From now on, before any image is designed OttoFlow plans the campaign first — objective,
                audience, awareness stage, message, CTA and funnel position — and every creative reinforces
                it. Strategies, winning patterns and funnel coverage will appear here as you generate.
              </p>
            </div>
          ) : (
            <div className="mb-8 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Campaigns planned" value={`${campaign.total_campaigns}`} />
                <Stat
                  label="Strategy diversity"
                  value={`${Math.round(campaign.diversity_score * 100)}%`}
                  hint="distinct strategies / total"
                />
                <Stat
                  label="Top strategy"
                  value={campaign.strategy_mix[0] ? fmtType(campaign.strategy_mix[0].campaign_type) : "—"}
                  hint={campaign.strategy_mix[0] ? `${campaign.strategy_mix[0].count} campaigns` : undefined}
                />
                <Stat
                  label="Best by engagement"
                  value={campaign.winning_strategies[0] ? fmtType(campaign.winning_strategies[0].campaign_type) : "—"}
                  hint={campaign.winning_strategies[0] ? `eng ${campaign.winning_strategies[0].avg_engagement}` : "needs measured campaigns"}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Strategy mix */}
                <div className="glass rounded-2xl p-4">
                  <p className="text-3xs font-semibold uppercase tracking-widest text-white/35 mb-2.5">Creative mix — strategies</p>
                  <ul className="space-y-1.5">
                    {campaign.strategy_mix.map((s) => (
                      <li key={s.campaign_type} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-white/80">{fmtType(s.campaign_type)}</span>
                        <span className="flex-shrink-0 text-xs text-white/45 tabular-nums">
                          ×{s.count}
                          {s.avg_engagement != null && (
                            <span className="text-emerald-400 font-semibold"> · eng {s.avg_engagement}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Funnel coverage */}
                <div className="glass rounded-2xl p-4">
                  <p className="text-3xs font-semibold uppercase tracking-widest text-white/35 mb-2.5">Funnel coverage</p>
                  {campaign.funnel_coverage.length === 0 ? (
                    <p className="text-xs text-white/30">No funnel data.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {campaign.funnel_coverage.map((f) => (
                        <li key={f.stage} className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-white/80">{f.stage}</span>
                          <span className="flex-shrink-0 text-xs text-white/45 tabular-nums">×{f.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {campaign.winning_strategies.length > 0 && (
                <Chips
                  title="Winning strategies — best real engagement"
                  items={campaign.winning_strategies.slice(0, 5).map((s) => `${fmtType(s.campaign_type)} · ${s.avg_engagement}`)}
                  tone="good"
                />
              )}
              {campaign.audience_trends.length > 0 && (
                <Chips title="Audience trends" items={campaign.audience_trends.map((a) => `${a.audience} ·×${a.count}`)} tone="warn" />
              )}

              {/* Recent campaigns timeline */}
              <div className="glass rounded-2xl p-4">
                <p className="text-3xs font-semibold uppercase tracking-widest text-white/35 mb-2.5">Campaign timeline — most recent</p>
                <ul className="space-y-2">
                  {campaign.recent.map((c, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      <span className="flex-shrink-0 mt-0.5 text-3xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#E9863B]/[0.12] text-[#F2A863]">
                        {fmtType(c.campaign_type)}
                      </span>
                      <span className="text-white/70 truncate">{c.core_message || "—"}</span>
                      {c.funnel_position && (
                        <span className="flex-shrink-0 ml-auto text-3xs text-white/30">{c.funnel_position}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* ── Performance Intelligence (Sprint 23) — REAL audience behavior;
                outranks the AI review score. ─────────────────────────────── */}
          <div className="flex items-center gap-2 mb-3 pt-2 border-t border-white/[0.04]">
            <Activity size={15} className="text-emerald-400 mt-4" />
            <h2 className="text-sm font-semibold text-white/85 mt-4">Performance Intelligence</h2>
            <span className="text-3xs uppercase tracking-wider text-white/30 mt-4">real audience behavior</span>
          </div>

          {!hasPerf ? (
            <div className="glass rounded-2xl p-6 text-center mb-8">
              <p className="text-white/65 text-sm font-medium">No performance data yet.</p>
              <p className="text-xs text-white/40 mt-1.5 max-w-lg mx-auto">
                Once published creatives report engagement — logged via Analytics or a connected platform —
                OttoFlow learns which creatives actually performed and optimizes for real behavior over AI
                opinion. Generation falls back to review-score intelligence until then.
              </p>
            </div>
          ) : (
            <div className="mb-8 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Measured campaigns" value={`${pi.measured_count}`} hint="posts with engagement data" />
                <Stat label="Baseline engagement" value={`${pi.baseline_engagement}`} hint="recency-weighted brand mean" />
                <Stat
                  label="Learning confidence"
                  value={`${Math.round(pi.learning_confidence * 100)}%`}
                  hint="grows with measured sample"
                />
                <Stat
                  label="Performance vs review"
                  value={pi.perf_vs_review == null ? "—" : `r=${pi.perf_vs_review}`}
                  hint={
                    pi.perf_vs_review == null
                      ? "needs ≥4 measured"
                      : pi.perf_vs_review >= 0.4
                        ? "review predicts engagement"
                        : "review ≠ engagement — trust behavior"
                  }
                />
              </div>

              {(pi.winning_patterns.length > 0 || pi.losing_patterns.length > 0) && (
                <div className="glass rounded-2xl p-5 space-y-4">
                  <Chips title="Winning patterns — leaning in" items={pi.winning_patterns} tone="good" />
                  <Chips title="Losing patterns — de-prioritising" items={pi.losing_patterns} tone="bad" />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(Object.keys(PERF_DIM_LABELS) as PerfDim[]).map((dim) => (
                  <PerfDimList key={dim} title={PERF_DIM_LABELS[dim] as string} stats={pi.top[dim]} />
                ))}
              </div>

              {pi.platform_breakdown.length > 0 && (
                <div className="glass rounded-2xl p-4">
                  <p className="text-3xs font-semibold uppercase tracking-widest text-white/35 mb-2.5">
                    Platform differences
                  </p>
                  <ul className="space-y-1.5">
                    {pi.platform_breakdown.map((p) => (
                      <li key={p.platform} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-white/80 capitalize">
                          {p.platform}
                          {p.top_world && <span className="text-white/35"> · best: {p.top_world}</span>}
                        </span>
                        <span className="flex-shrink-0 text-xs font-semibold text-white/70 tabular-nums">
                          {p.avg_engagement}
                          <span className="text-white/30 font-normal"> ·{p.count}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {pi.timeline.length >= 2 && (
                <div className="glass rounded-2xl p-4">
                  <p className="text-3xs font-semibold uppercase tracking-widest text-white/35 mb-2">
                    Creative performance timeline
                  </p>
                  <Sparkline pts={pi.timeline} />
                </div>
              )}

              {pi.rationale.length > 0 && (
                <div className="glass rounded-2xl p-5">
                  <p className="text-sm font-semibold text-white/80 mb-2.5">
                    What's working right now
                    <span className="ml-2 text-3xs font-normal uppercase tracking-wider text-white/30">internal only</span>
                  </p>
                  <ul className="space-y-1.5">
                    {pi.rationale.map((r, i) => (
                      <li key={i} className="flex gap-2 text-sm text-white/65">
                        <span className="text-emerald-400 flex-shrink-0">•</span>
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ── Review-score intelligence (Sprint 22) ───────────────────────── */}
          <div className="flex items-center gap-2 mb-3 pt-2 border-t border-white/[0.04]">
            <h2 className="text-sm font-semibold text-white/85 mt-4">Review-score intelligence</h2>
            <span className="text-3xs uppercase tracking-wider text-white/30 mt-4">what the AI reviewer rates highest</span>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
            <Stat label="Average review score" value={`${ci.avg_score}`} hint={`over ${ci.delivered_count} delivered`} />
            <Stat label="Pass rate" value={`${Math.round(ci.pass_rate * 100)}%`} hint="met the quality bar, first or after revisions" />
            <Stat label="Average revisions" value={`${ci.avg_revisions}`} hint="self-improvement cycles per delivery" />
            <Stat
              label="Diversity score"
              value={`${Math.round(ci.diversity_score * 100)}%`}
              hint="world variety in the recent window"
            />
            <Stat
              label="Improvement trend"
              value={trendStr}
              hint={trend > 0 ? "scores rising over time" : trend < 0 ? "scores slipping — watch convergence" : "flat"}
            />
            <Stat label="Learned from" value={`${ci.sample_size}`} hint="high-scoring delivered creatives" />
          </div>

          {/* Diversity protection chips */}
          {(ci.overused.length > 0 || ci.explore.length > 0 || ci.avoid.length > 0) && (
            <div className="glass rounded-2xl p-5 mb-6 space-y-4">
              <p className="text-sm font-semibold text-white/80">Diversity protection</p>
              <Chips title="Overused recently — rotating away from" items={ci.overused} tone="warn" />
              <Chips title="Underused & on-brand — exploring next" items={ci.explore} tone="good" />
              <Chips title="Worst worlds — repeatedly weak, avoiding" items={ci.avoid} tone="bad" />
            </div>
          )}

          {/* Best dimensions */}
          <p className="text-sm font-semibold text-white/80 mb-3">Best-performing creative directions</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
            {(Object.keys(DIM_LABELS) as DimKey[]).map((dim) => (
              <DimList key={dim} title={DIM_LABELS[dim]} stats={ci.best[dim]} />
            ))}
          </div>

          {/* Explainability */}
          {ci.rationale.length > 0 && (
            <div className="glass rounded-2xl p-5">
              <p className="text-sm font-semibold text-white/80 mb-2.5">
                How the next generation is being guided
                <span className="ml-2 text-3xs font-normal uppercase tracking-wider text-white/30">internal only</span>
              </p>
              <ul className="space-y-1.5">
                {ci.rationale.map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm text-white/65">
                    <span className="text-[#F2A863] flex-shrink-0">•</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
