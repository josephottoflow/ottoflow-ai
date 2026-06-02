import { KPICard } from "@/components/KPICard";
import { UsageChart } from "@/components/UsageChart";
import {
  getAnalyticsData,
  getKPISummary,
  getProviderAnalytics,
  getAIBurnSeries,
} from "@/lib/db";
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
  const [kpis, chartData, providerStats, burnSeries] = await Promise.all([
    getKPISummary(),
    getAnalyticsData(14),
    getProviderAnalytics(14),
    getAIBurnSeries(14),
  ]);

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
            <span className="text-[10px] text-white/30 flex items-center gap-1">
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
                  <span className="text-[9px] text-white/25 truncate w-full text-center">
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
        <span className="text-[11px] text-white/40">last 14 days</span>
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
          <div className="text-[12px] text-white/40 py-6 text-center">
            No scene-generation data in the last 14 days. Generate a video to see
            provider analytics here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
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
                      <Badge variant={PROVIDER_VARIANT[row.provider] ?? "purple"} className="text-[10px]">
                        {row.provider}
                      </Badge>
                    </td>
                    <td className="text-right py-2 px-2 text-white/80">
                      {formatNumber(row.attempts)}
                    </td>
                    <td className="text-right py-2 px-2">
                      <Badge
                        variant={statusBadgeForRate(row.successRatePct)}
                        className="text-[10px]"
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
          <span className="text-[10px] text-white/30 flex items-center gap-1">
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
                <span className="text-[9px] text-white/25 truncate w-full text-center">
                  {d.date.split(" ")[1]}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
