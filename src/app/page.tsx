import { KPICard } from "@/components/KPICard";
import { ActivityFeed } from "@/components/ActivityFeed";
import { RenderQueue } from "@/components/RenderQueue";
import { UsageChart } from "@/components/UsageChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelative, formatNumber } from "@/lib/utils";
import { getKPISummary, getProjects, getActivity, getRenderJobs, getAnalyticsData } from "@/lib/db";
import {
  FileText,
  Video,
  Zap,
  Plus,
  ArrowRight,
  FolderOpen,
  BarChart3,
  Clock,
} from "lucide-react";
import Link from "next/link";

export const revalidate = 30; // ISR: refresh every 30 s

export default async function DashboardPage() {
  const [kpis, projects, activity, renderJobs, chartData] = await Promise.all([
    getKPISummary(),
    getProjects(),
    getActivity(6),
    getRenderJobs(undefined, 4),
    getAnalyticsData(14),
  ]);

  const activeProjects = projects.filter((p) => p.status === "active");
  const pendingJobs = renderJobs.filter((j) => j.status !== "done").length;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <p className="text-sm text-white/40 mb-1">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Good morning, Joseph 👋
          </h1>
          <p className="text-white/45 text-sm mt-1">
            You have{" "}
            <span className="text-violet-400 font-medium">{kpis.renderQueue} renders queued</span>{" "}
            and{" "}
            <span className="text-cyan-400 font-medium">{kpis.publishedToday} posts published</span>{" "}
            today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/analytics">
            <Button variant="outline" size="sm" className="gap-1.5">
              <BarChart3 size={14} />
              Reports
            </Button>
          </Link>
          <Link href="/projects">
            <Button variant="gradient" size="sm" className="gap-1.5">
              <Plus size={14} />
              New Project
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Content Generated"
          value={formatNumber(kpis.totalContent)}
          subtitle="All time"
          icon={<FileText size={18} />}
          iconColor="#a78bfa"
          iconBg="rgba(124, 58, 237, 0.12)"
        />
        <KPICard
          title="Videos Rendered"
          value={kpis.totalVideos}
          subtitle="Completed"
          icon={<Video size={18} />}
          iconColor="#67e8f9"
          iconBg="rgba(6, 182, 212, 0.12)"
        />
        <KPICard
          title="Credits Used"
          value={formatNumber(kpis.creditsUsed)}
          subtitle={`${formatNumber(kpis.creditsTotal - kpis.creditsUsed)} remaining`}
          icon={<Zap size={18} />}
          iconColor="#fbbf24"
          iconBg="rgba(245, 158, 11, 0.12)"
        />
        <KPICard
          title="Active Projects"
          value={kpis.activeProjects}
          subtitle={`${kpis.publishedToday} posts today`}
          icon={<FolderOpen size={18} />}
          iconColor="#34d399"
          iconBg="rgba(16, 185, 129, 0.12)"
        />
      </div>

      {/* Pipeline Products */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
        {/* Content Pipeline Card */}
        <div className="glass rounded-2xl p-5 card-hover relative overflow-hidden group">
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl"
            style={{ background: "radial-gradient(ellipse at top left, rgba(124,58,237,0.08) 0%, transparent 60%)" }}
          />
          <div className="relative">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.2), rgba(99,102,241,0.1))", border: "1px solid rgba(124,58,237,0.2)" }}>
                  <FileText size={18} className="text-violet-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Content Pipeline</h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 status-dot-live" />
                    <span className="text-[10px] text-emerald-400 font-medium">Active · Basic Tier</span>
                  </div>
                </div>
              </div>
              <Badge variant="purple" className="text-[10px]">Gemini Flash Lite</Badge>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: "Generated", value: formatNumber(kpis.totalContent), color: "#a78bfa" },
                { label: "Published", value: formatNumber(kpis.publishedToday), color: "#34d399" },
                { label: "In Queue", value: String(kpis.renderQueue), color: "#94a3b8" },
              ].map((s) => (
                <div key={s.label} className="text-center p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
                  <div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-[10px] text-white/40">{s.label}</div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
              {["Brief", "Research", "Strategy", "Generate", "Approve", "Publish"].map((step, i, arr) => (
                <div key={step} className="flex items-center gap-1 flex-shrink-0">
                  <div className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md"
                    style={{
                      background: i < 4 ? "rgba(124,58,237,0.12)" : "rgba(255,255,255,0.04)",
                      color: i < 4 ? "#a78bfa" : "rgba(255,255,255,0.3)",
                    }}>
                    {step}
                  </div>
                  {i < arr.length - 1 && <div className="w-3 h-px bg-white/10" />}
                </div>
              ))}
            </div>

            <Link href="/content">
              <Button variant="outline" size="sm" className="w-full gap-1.5 text-violet-400 border-violet-500/20 hover:border-violet-500/40 hover:bg-violet-500/8">
                Open Pipeline <ArrowRight size={13} />
              </Button>
            </Link>
          </div>
        </div>

        {/* Video Pipeline Card */}
        <div className="glass rounded-2xl p-5 card-hover relative overflow-hidden group">
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl"
            style={{ background: "radial-gradient(ellipse at top left, rgba(6,182,212,0.08) 0%, transparent 60%)" }}
          />
          <div className="relative">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(59,130,246,0.1))", border: "1px solid rgba(6,182,212,0.2)" }}>
                  <Video size={18} className="text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Video Pipeline</h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 status-dot-live" />
                    <span className="text-[10px] text-emerald-400 font-medium">Active · Advanced Tier</span>
                  </div>
                </div>
              </div>
              <Badge variant="info" className="text-[10px]">Higgsfield + Veo 3</Badge>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: "Rendered", value: formatNumber(kpis.totalVideos), color: "#67e8f9" },
                { label: "Processing", value: String(pendingJobs), color: "#fbbf24" },
                { label: "Credits", value: formatNumber(kpis.creditsUsed), color: "#94a3b8" },
              ].map((s) => (
                <div key={s.label} className="text-center p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
                  <div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-[10px] text-white/40">{s.label}</div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
              {["Brief", "Script", "Storyboard", "Clips", "Voice", "Captions", "Export"].map((step, i, arr) => (
                <div key={step} className="flex items-center gap-1 flex-shrink-0">
                  <div className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md"
                    style={{
                      background: i < 5 ? "rgba(6,182,212,0.12)" : "rgba(255,255,255,0.04)",
                      color: i < 5 ? "#67e8f9" : "rgba(255,255,255,0.3)",
                    }}>
                    {step}
                  </div>
                  {i < arr.length - 1 && <div className="w-3 h-px bg-white/10" />}
                </div>
              ))}
            </div>

            <Link href="/video">
              <Button variant="outline" size="sm" className="w-full gap-1.5 text-cyan-400 border-cyan-500/20 hover:border-cyan-500/40 hover:bg-cyan-500/8">
                Open Pipeline <ArrowRight size={13} />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px_280px] gap-4">

        {/* Recent Projects */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Recent Projects</h2>
            <Link href="/projects">
              <Button variant="ghost" size="sm" className="text-xs h-7 gap-1 text-white/40 hover:text-white/70 px-2">
                View all <ArrowRight size={11} />
              </Button>
            </Link>
          </div>
          <div className="space-y-2">
            {activeProjects.slice(0, 5).map((proj) => (
              <Link key={proj.id} href={`/projects/${proj.id}`}>
                <div className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors hover:bg-white/[0.03]"
                  style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
                  <div className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center"
                    style={{
                      background: proj.type === "video"
                        ? "rgba(6,182,212,0.1)"
                        : "rgba(124,58,237,0.1)",
                    }}>
                    {proj.type === "video"
                      ? <Video size={14} className="text-cyan-400" />
                      : <FileText size={14} className="text-violet-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white/80 truncate">{proj.name}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[10px] text-white/35">
                        {proj.content_count > 0 ? `${proj.content_count} posts` : `${proj.video_count} videos`}
                      </span>
                      <span className="text-[10px] text-white/25">
                        {formatRelative(proj.updated_at)}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {(proj.tags ?? []).slice(0, 2).map((t: string) => (
                      <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-md font-medium"
                        style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.35)" }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            ))}
            {activeProjects.length === 0 && (
              <p className="text-xs text-white/30 text-center py-6">No active projects yet.</p>
            )}
          </div>
        </div>

        {/* Activity Feed */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Activity</h2>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 status-dot-live" />
              <span className="text-[10px] text-emerald-400">Live</span>
            </div>
          </div>
          <ActivityFeed items={activity} />
        </div>

        {/* Usage chart + Render queue */}
        <div className="space-y-4">
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white">Usage</h2>
              <div className="flex items-center gap-3 text-[10px] text-white/40">
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-violet-500" />Content
                </span>
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-cyan-500" />Videos
                </span>
              </div>
            </div>
            <UsageChart data={chartData} />
          </div>

          <div className="glass rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white">Render Queue</h2>
              <Badge variant="warning" className="text-[10px]">
                <Clock size={9} className="mr-1" />
                {pendingJobs} pending
              </Badge>
            </div>
            <RenderQueue jobs={renderJobs} />
          </div>
        </div>
      </div>
    </div>
  );
}
