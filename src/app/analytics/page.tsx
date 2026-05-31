import { KPICard } from "@/components/KPICard";
import { UsageChart } from "@/components/UsageChart";
import { getAnalyticsData, getKPISummary } from "@/lib/db";
import { formatNumber } from "@/lib/utils";
import { TrendingUp, Eye, Send, Video, Zap } from "lucide-react";

export const revalidate = 30;

export default async function AnalyticsPage() {
  const [kpis, chartData] = await Promise.all([
    getKPISummary(),
    getAnalyticsData(14),
  ]);

  const totalContent14d = chartData.reduce((acc, p) => acc + p.content, 0);
  const totalVideos14d  = chartData.reduce((acc, p) => acc + p.videos,  0);
  const peakCredits = chartData.reduce((m, p) => Math.max(m, p.credits), 0);

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
    </div>
  );
}
