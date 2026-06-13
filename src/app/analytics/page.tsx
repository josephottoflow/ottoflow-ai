import { KPICard } from "@/components/KPICard";
import { UsageChart } from "@/components/UsageChart";
import { MetricsQuickEntry } from "@/components/MetricsQuickEntry";
import {
  getAnalyticsData,
  getKPISummary,
  getProviderAnalytics,
  getAIBurnSeries,
  getContentPerformance,
  getLensInventory,
  getCreativeHierarchyPerformance,
  type PerfGroup,
  type HierarchyGroup,
} from "@/lib/db";
import { generateRecommendations, type Recommendation } from "@/lib/recommendations";
import { formatNumber } from "@/lib/utils";
import {
  TrendingUp,
  Eye,
  Send,
  Video,
  Zap,
  DollarSign,
  Activity,
  AlertTriangle,
  Layers,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const revalidate = 30;

const PROVIDER_VARIANT: Record<
  string,
  "purple" | "info" | "success" | "warning" | "destructive"
> = {
  runway: "purple",
  luma: "info",
  pexels: "success",
  failed: "destructive",
};

function statusBadgeForRate(rate: number) {
  if (rate >= 95) return "success" as const;
  if (rate >= 75) return "warning" as const;
  return "destructive" as const;
}

export default async function AnalyticsPage() {
  const [kpis, chartData, providerStats, burnSeries, perf, lensInventory, hierarchyPerf] =
    await Promise.all([
      getKPISummary(),
      getAnalyticsData(14),
      getProviderAnalytics(14),
      getAIBurnSeries(14),
      getContentPerformance(),
      getLensInventory(),
      getCreativeHierarchyPerformance(),
    ]);

  const recommendations = generateRecommendations(perf, lensInventory, hierarchyPerf);

  const withER = perf.items.filter((i) => i.engagementRate != null);
  const topPosts = [...withER].sort((a, b) => b.engagementRate! - a.engagementRate!).slice(0, 5);
  const bottomPosts =
    withER.length > 1
      ? [...withER].sort((a, b) => a.engagementRate! - b.engagementRate!).slice(0, Math.min(5, withER.length - 1))
      : [];

  const totalContent14d = chartData.reduce((acc, p) => acc + p.content, 0);
  const totalVideos14d  = chartData.reduce((acc, p) => acc + p.videos,  0);
  const peakCredits = chartData.reduce((m, p) => Math.max(m, p.credits), 0);

  // Aggregate provider stats for KPI tiles
  const totalScenes14d = providerStats.reduce((acc, p) => acc + p.attempts, 0);
  const totalCost14d   = providerStats.reduce((acc, p) => acc + p.totalCostUsd, 0);
  const totalFallbacks = providerStats.reduce((acc, p) => acc + p.fallbackCount, 0);
  const totalSuccesses = providerStats.reduce((acc, p) => acc + p.successes, 0);
  const overallSuccessRate =
    totalScenes14d > 0 ? Math.round((totalSuccesses / totalScenes14d) * 1000) / 10 : null;
  const peakBurn = burnSeries.reduce((m, p) => Math.max(m, p.costUsd), 0);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white tracking-tight">Analytics</h1>
        <p className="text-white/40 text-sm mt-1">Performance metrics across all pipelines</p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Content (14d)"
          value={formatNumber(totalContent14d)}
          icon={<Eye size={18} />}
          iconColor="#a78bfa"
          iconBg="rgba(124,58,237,0.12)"
        />
        <KPICard
          title="Videos (14d)"
          value={formatNumber(totalVideos14d)}
          icon={<TrendingUp size={18} />}
          iconColor="#34d399"
          iconBg="rgba(16,185,129,0.12)"
        />
        <KPICard
          title="Total Content"
          value={formatNumber(kpis.totalContent)}
          icon={<Send size={18} />}
          iconColor="#67e8f9"
          iconBg="rgba(6,182,212,0.12)"
        />
        <KPICard
          title="Total Videos"
          value={formatNumber(kpis.totalVideos)}
          icon={<Video size={18} />}
          iconColor="#fb923c"
          iconBg="rgba(251,146,60,0.12)"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="glass rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Content vs Video Output</h3>
          <UsageChart data={chartData} />
        </div>
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Credit Consumption</h3>
            <span className="text-3xs text-white/30 flex items-center gap-1">
              <Zap size={10} className="text-amber-400/70" />
              {formatNumber(kpis.creditsUsed)} used total
            </span>
          </div>
          {peakCredits === 0 ? (
            <div className="h-48 flex items-center justify-center text-xs text-white/30">
              No credit usage in the last 14 days.
            </div>
          ) : (
            <div className="h-48 flex items-end gap-1.5">
              {chartData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t-md"
                    style={{
                      height: `${(d.credits / peakCredits) * 160}px`,
                      background: "linear-gradient(to top, rgba(245,158,11,0.5), rgba(251,191,36,0.3))",
                    }}
                  />
                  <span className="text-3xs text-white/25 truncate w-full text-center">
                    {d.date.split(" ")[1]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── Provider Analytics ─────────────────────────────────────── */}
      <div className="mt-8 mb-4 flex items-center gap-2">
        <h2 className="text-lg font-bold text-white">Video provider analytics</h2>
        <span className="text-2xs text-white/40">last 14 days</span>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Scenes generated"
          value={formatNumber(totalScenes14d)}
          icon={<Layers size={18} />}
          iconColor="#67e8f9"
          iconBg="rgba(6,182,212,0.12)"
        />
        <KPICard
          title="Success rate"
          value={overallSuccessRate != null ? `${overallSuccessRate}%` : "—"}
          icon={<Activity size={18} />}
          iconColor="#34d399"
          iconBg="rgba(16,185,129,0.12)"
        />
        <KPICard
          title="AI spend"
          value={`$${totalCost14d.toFixed(2)}`}
          icon={<DollarSign size={18} />}
          iconColor="#a78bfa"
          iconBg="rgba(124,58,237,0.12)"
        />
        <KPICard
          title="Fallback rate"
          value={
            totalScenes14d > 0
              ? `${Math.round((totalFallbacks / totalScenes14d) * 1000) / 10}%`
              : "—"
          }
          icon={<AlertTriangle size={18} />}
          iconColor="#fb923c"
          iconBg="rgba(251,146,60,0.12)"
        />
      </div>

      {/* Provider breakdown table */}
      <div className="glass rounded-2xl p-5 mb-5">
        <h3 className="text-sm font-semibold text-white mb-4">Per-provider performance</h3>
        {providerStats.length === 0 ? (
          <div className="text-xs text-white/40 py-6 text-center">
            No scene-generation data in the last 14 days. Generate a video to see
            provider analytics here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-white/40 border-b border-white/[0.06]">
                  <th className="text-left font-semibold py-2 px-2">Provider</th>
                  <th className="text-right font-semibold py-2 px-2">Scenes</th>
                  <th className="text-right font-semibold py-2 px-2">Success</th>
                  <th className="text-right font-semibold py-2 px-2">Avg gen</th>
                  <th className="text-right font-semibold py-2 px-2">p50</th>
                  <th className="text-right font-semibold py-2 px-2">p95</th>
                  <th className="text-right font-semibold py-2 px-2">Cost</th>
                  <th className="text-right font-semibold py-2 px-2">Fallbacks</th>
                </tr>
              </thead>
              <tbody>
                {providerStats.map((row) => (
                  <tr key={row.provider} className="border-b border-white/[0.03]">
                    <td className="py-2 px-2">
                      <Badge variant={PROVIDER_VARIANT[row.provider] ?? "purple"} className="text-3xs">
                        {row.provider}
                      </Badge>
                    </td>
                    <td className="text-right py-2 px-2 text-white/80">
                      {formatNumber(row.attempts)}
                    </td>
                    <td className="text-right py-2 px-2">
                      <Badge
                        variant={statusBadgeForRate(row.successRatePct)}
                        className="text-3xs"
                      >
                        {row.successRatePct}%
                      </Badge>
                    </td>
                    <td className="text-right py-2 px-2 text-white/70">
                      {row.avgGenMs != null ? `${(row.avgGenMs / 1000).toFixed(1)}s` : "—"}
                    </td>
                    <td className="text-right py-2 px-2 text-white/50">
                      {row.p50GenMs != null ? `${(row.p50GenMs / 1000).toFixed(1)}s` : "—"}
                    </td>
                    <td className="text-right py-2 px-2 text-white/50">
                      {row.p95GenMs != null ? `${(row.p95GenMs / 1000).toFixed(1)}s` : "—"}
                    </td>
                    <td className="text-right py-2 px-2 text-white/80">
                      ${row.totalCostUsd.toFixed(2)}
                    </td>
                    <td className="text-right py-2 px-2 text-white/60">
                      {row.fallbackCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* AI spend chart */}
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">AI spend per day</h3>
          <span className="text-3xs text-white/30 flex items-center gap-1">
            <DollarSign size={10} className="text-violet-400/70" />
            ${totalCost14d.toFixed(2)} (14d total)
          </span>
        </div>
        {peakBurn === 0 ? (
          <div className="h-48 flex items-center justify-center text-xs text-white/30">
            No AI spend yet — Runway and Luma haven&apos;t been activated.
          </div>
        ) : (
          <div className="h-48 flex items-end gap-1.5">
            {burnSeries.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`$${d.costUsd.toFixed(2)} · ${d.sceneCount} scenes`}>
                <div
                  className="w-full rounded-t-md"
                  style={{
                    height: `${(d.costUsd / peakBurn) * 160}px`,
                    background: "linear-gradient(to top, rgba(124,58,237,0.6), rgba(167,139,250,0.3))",
                  }}
                />
                <span className="text-3xs text-white/25 truncate w-full text-center">
                  {d.date.split(" ")[1]}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Content Performance (Analytics Ingestion v1) ─────────────── */}
      <div className="mt-8 mb-4 flex items-center gap-2">
        <h2 className="text-lg font-bold text-white">Content performance</h2>
        <span className="text-2xs text-white/40">
          {perf.items.length} published · {withER.length} with metrics
        </span>
      </div>

      <div className="mb-5">
        <MetricsQuickEntry />
      </div>

      {/* Optimization Recommendations v1 — rule-based, recomputed per load */}
      {recommendations.length > 0 && (
        <div className="glass rounded-2xl p-5 mb-5">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-white">Recommendations</h3>
            <span className="text-3xs text-white/30">
              derived from your performance data · refreshed on every visit
            </span>
          </div>
          <p className="text-2xs text-white/35 mb-4">
            Each recommendation shows its reasoning and the data behind it. “Early signal”
            means the sample is still small — treat it as a hint, not a verdict.
          </p>
          <div className="space-y-3">
            {recommendations.map((rec) => (
              <RecCard key={rec.id} rec={rec} />
            ))}
          </div>
        </div>
      )}

      {perf.items.length === 0 ? (
        <div className="glass rounded-2xl p-6 text-xs text-white/40">
          Nothing published yet — publish posts from the Publishing queue, then record
          their metrics here.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
            <PostList title="Top performing posts" items={topPosts} emptyHint="Record metrics on a published post to rank it here." />
            <PostList title="Lowest performing posts" items={bottomPosts} emptyHint="Needs at least two posts with metrics." />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
            <GroupTable title="Performance by brand" groups={perf.byBrand} keyLabel="Brand" />
            <GroupTable title="Performance by platform" groups={perf.byPlatform} keyLabel="Platform" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <GroupTable title="Best topics" groups={perf.byTopic.slice(0, 6)} keyLabel="Topic" compact />
            <GroupTable title="Best opportunity lenses" groups={perf.byLens.slice(0, 6)} keyLabel="Lens" compact />
            <GroupTable title="Best evidence sources" groups={perf.byEvidenceDomain.slice(0, 6)} keyLabel="Source domain" compact />
          </div>
        </>
      )}

      {/* ─── Creative hierarchy performance (Creative Orchestrator Phase D) ─── */}
      {hierarchyPerf.totalCreatives > 0 && (
        <>
          <div className="mt-8 mb-4 flex items-center gap-2">
            <Layers size={16} className="text-fuchsia-400" />
            <h2 className="text-lg font-bold text-white">Creative hierarchy performance</h2>
            <span className="text-2xs text-white/40">
              {hierarchyPerf.totalCreatives} generated creative
              {hierarchyPerf.totalCreatives === 1 ? "" : "s"} on published posts
            </span>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <HierarchyTable title="Overall — which hierarchy wins" rows={hierarchyPerf.overall} />
            <HierarchyDimTable
              title="Best hierarchy per platform"
              dims={hierarchyPerf.byPlatform.slice(0, 6)}
              dimLabel="Platform"
            />
            <HierarchyDimTable
              title="Best hierarchy per brand"
              dims={hierarchyPerf.byBrand.slice(0, 6)}
              dimLabel="Brand"
            />
          </div>
        </>
      )}
    </div>
  );
}

// ─── Creative hierarchy presentation (Phase D) ───────────────────────────────

const HIERARCHY_LABEL: Record<string, string> = {
  founder_led: "Founder-led",
  brand_led: "Brand-led",
  data_led: "Data-led",
  quote_led: "Quote-led",
  product_led: "Product-led",
};

function erText(v: number | null): string {
  return v != null ? `${(v * 100).toFixed(1)}%` : "—";
}

function HierarchyTable({ title, rows }: { title: string; rows: HierarchyGroup[] }) {
  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-white/35 py-4">No data yet.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-white/40 border-b border-white/[0.06]">
              <th className="text-left font-semibold py-1.5 pr-2">Hierarchy</th>
              <th className="text-right font-semibold py-1.5 px-2">Creatives</th>
              <th className="text-right font-semibold py-1.5 pl-2">Avg ER</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-white/[0.03]">
                <td className="py-1.5 pr-2 text-white/80">
                  {HIERARCHY_LABEL[r.key] ?? r.key}
                </td>
                <td className="py-1.5 px-2 text-right text-white/50">
                  {r.withMetrics}/{r.posts}
                </td>
                <td className="py-1.5 pl-2 text-right font-semibold text-emerald-400">
                  {erText(r.avgER)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function HierarchyDimTable({
  title,
  dims,
  dimLabel,
}: {
  title: string;
  dims: Array<{ dim: string; rows: HierarchyGroup[] }>;
  dimLabel: string;
}) {
  const withWinner = dims.filter((d) => d.rows.some((r) => r.avgER != null));
  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
      {withWinner.length === 0 ? (
        <p className="text-xs text-white/35 py-4">
          No measured creatives yet — record metrics on published posts that
          have a generated creative.
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-white/40 border-b border-white/[0.06]">
              <th className="text-left font-semibold py-1.5 pr-2">{dimLabel}</th>
              <th className="text-left font-semibold py-1.5 px-2">Best hierarchy</th>
              <th className="text-right font-semibold py-1.5 pl-2">Avg ER</th>
            </tr>
          </thead>
          <tbody>
            {withWinner.map((d) => {
              const best = d.rows.find((r) => r.avgER != null)!;
              return (
                <tr key={d.dim} className="border-b border-white/[0.03]">
                  <td className="py-1.5 pr-2 text-white/75 truncate max-w-[120px]">{d.dim}</td>
                  <td className="py-1.5 px-2 text-white/80">
                    {HIERARCHY_LABEL[best.key] ?? best.key}
                  </td>
                  <td className="py-1.5 pl-2 text-right font-semibold text-emerald-400">
                    {erText(best.avgER)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Content-performance presentation helpers ────────────────────────────────

const REC_KIND_META: Record<Recommendation["kind"], { label: string; className: string }> = {
  topic: { label: "Topic", className: "text-violet-300 border-violet-500/40 bg-violet-500/10" },
  lens: { label: "Opportunity lens", className: "text-amber-300 border-amber-500/40 bg-amber-500/10" },
  evidence: { label: "Evidence", className: "text-cyan-300 border-cyan-500/40 bg-cyan-500/10" },
  platform: { label: "Platform", className: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
  creative: { label: "Creative", className: "text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-500/10" },
  hygiene: { label: "Data quality", className: "text-white/50 border-white/15 bg-white/5" },
};

function RecCard({ rec }: { rec: Recommendation }) {
  const meta = REC_KIND_META[rec.kind];
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className={`rounded-full border px-2 py-0.5 text-3xs font-medium ${meta.className}`}>
          {meta.label}
        </span>
        {rec.earlySignal && (
          <span className="rounded-full border border-white/15 px-2 py-0.5 text-3xs text-white/40">
            early signal
          </span>
        )}
      </div>
      <p className="text-sm font-medium text-white/90">{rec.action}</p>
      <p className="text-xs text-white/55 leading-relaxed mt-1">
        <span className="text-white/30">Why: </span>
        {rec.why}
      </p>
      {rec.metrics.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
          {rec.metrics.map((m) => (
            <span key={m.label} className="text-2xs text-white/45">
              <span className="text-white/30">{m.label}:</span>{" "}
              <span className="text-white/70">{m.value}</span>
            </span>
          ))}
        </div>
      )}
      {rec.examples.length > 0 && (
        <div className="mt-2 space-y-1">
          {rec.examples.map((e, i) => (
            <p key={i} className="text-2xs text-white/40 truncate">
              · {e.title}
              {e.er != null && (
                <span className="text-emerald-400/80"> — {(e.er * 100).toFixed(2)}% ER</span>
              )}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function PostList({
  title,
  items,
  emptyHint,
}: {
  title: string;
  items: Array<{
    id: string;
    title: string;
    platform: string;
    brandName: string | null;
    impressions: number | null;
    engagementRate: number | null;
  }>;
  emptyHint: string;
}) {
  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-white/35 py-4">{emptyHint}</p>
      ) : (
        <div className="space-y-2">
          {items.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2">
              <Badge variant="outline" className="text-3xs shrink-0">{p.platform}</Badge>
              <span className="text-xs text-white/75 truncate flex-1">{p.title}</span>
              {p.brandName && <span className="text-3xs text-white/30 shrink-0">{p.brandName}</span>}
              {p.impressions != null && (
                <span className="text-3xs text-white/45 shrink-0">{formatNumber(p.impressions)} imp</span>
              )}
              <span className="text-xs font-semibold text-emerald-400 shrink-0">
                {p.engagementRate != null ? `${(p.engagementRate * 100).toFixed(2)}%` : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupTable({
  title,
  groups,
  keyLabel,
  compact,
}: {
  title: string;
  groups: PerfGroup[];
  keyLabel: string;
  compact?: boolean;
}) {
  const rows = groups.filter((g) => g.posts > 0);
  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-white/35 py-4">No data yet.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-white/40 border-b border-white/[0.06]">
              <th className="text-left font-semibold py-1.5 pr-2">{keyLabel}</th>
              <th className="text-right font-semibold py-1.5 px-2">Posts</th>
              {!compact && <th className="text-right font-semibold py-1.5 px-2">Impressions</th>}
              <th className="text-right font-semibold py-1.5 pl-2">Avg ER</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.key} className="border-b border-white/[0.03]">
                <td className="py-1.5 pr-2 text-white/75 truncate max-w-[180px]">{g.key}</td>
                <td className="text-right py-1.5 px-2 text-white/60">
                  {g.posts}
                  {g.withMetrics < g.posts && (
                    <span className="text-white/25"> ({g.withMetrics}✓)</span>
                  )}
                </td>
                {!compact && (
                  <td className="text-right py-1.5 px-2 text-white/60">
                    {formatNumber(g.totalImpressions)}
                  </td>
                )}
                <td className="text-right py-1.5 pl-2 font-medium text-emerald-400">
                  {g.avgER != null ? `${(g.avgER * 100).toFixed(2)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
