/**
 * Creative Intelligence dashboard (Sprint 22) — INTERNAL operations only.
 *
 * A read-only view of what a brand has LEARNED: average review score, pass rate,
 * average revisions, diversity score, improvement trend, the best (and worst)
 * creative worlds + dimensions, and the internal "chosen because" rationale.
 * Pure server component — no customer UI, no interactivity.
 */
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import type { CreativeIntelligence, DimKey, DimStat } from "@/lib/creative/brand-intelligence";
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

export function IntelligenceDashboard({ brand, ci }: { brand: DbBrand; ci: CreativeIntelligence }) {
  const trend = ci.improvement_trend;
  const trendStr = trend > 0 ? `+${trend}` : `${trend}`;
  const empty = ci.delivered_count < 1;

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
                    <span className="text-violet-400 flex-shrink-0">•</span>
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
