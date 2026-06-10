"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelative, formatNumber } from "@/lib/utils";
import type { DbProject } from "@/lib/types";
import {
  FolderOpen,
  Plus,
  Video,
  FileText,
  Zap,
  MoreHorizontal,
  Search,
  Grid3X3,
  List,
  ArrowRight,
  TrendingUp,
  Clock,
} from "lucide-react";

const statusConfig: Record<string, { label: string; variant: "success" | "info" | "secondary" | "warning" }> = {
  active: { label: "Active", variant: "success" },
  completed: { label: "Completed", variant: "info" },
  draft: { label: "Draft", variant: "secondary" },
  paused: { label: "Paused", variant: "warning" },
};

interface Props {
  projects: DbProject[];
}

export function ProjectsPageClient({ projects }: Props) {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [filter, setFilter] = useState<"all" | "content" | "video">("all");
  const [search, setSearch] = useState("");

  const filtered = projects.filter((p) => {
    if (filter !== "all" && p.type !== filter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: projects.length,
    active: projects.filter((p) => p.status === "active").length,
    content: projects.filter((p) => p.type === "content").length,
    video: projects.filter((p) => p.type === "video").length,
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Projects</h1>
          <p className="text-white/40 text-sm mt-1">
            {stats.active} active · {stats.content} content · {stats.video} video
          </p>
        </div>
        <Button variant="gradient" size="sm" className="gap-1.5" disabled title="Project creation arrives with content/video pipelines">
          <Plus size={14} />
          New Project
          <Badge variant="info" className="text-3xs ml-1">Soon</Badge>
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total Projects", value: stats.total, icon: FolderOpen, color: "#a78bfa" },
          { label: "Active", value: stats.active, icon: TrendingUp, color: "#34d399" },
          { label: "Content", value: stats.content, icon: FileText, color: "#6366f1" },
          { label: "Video", value: stats.video, icon: Video, color: "#67e8f9" },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="glass rounded-xl p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: `${s.color}15` }}>
                <Icon size={16} style={{ color: s.color }} />
              </div>
              <div>
                <div className="text-xl font-bold text-white">{s.value}</div>
                <div className="text-3xs text-white/40">{s.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="w-full text-xs text-white/70 placeholder:text-white/25 pl-8 pr-4 py-2 rounded-xl outline-none focus:border-violet-500/40 transition-colors"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }}>
          {(["all", "content", "video"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="text-2xs font-medium px-3 py-1.5 rounded-lg capitalize transition-all"
              style={{
                background: filter === f ? "rgba(124,58,237,0.15)" : "transparent",
                color: filter === f ? "#a78bfa" : "rgba(255,255,255,0.4)",
              }}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }}>
          <button
            onClick={() => setView("grid")}
            className="p-1.5 rounded-lg transition-all"
            style={{ background: view === "grid" ? "rgba(255,255,255,0.08)" : "transparent" }}
          >
            <Grid3X3 size={13} style={{ color: view === "grid" ? "#e2e8f0" : "rgba(255,255,255,0.35)" }} />
          </button>
          <button
            onClick={() => setView("list")}
            className="p-1.5 rounded-lg transition-all"
            style={{ background: view === "list" ? "rgba(255,255,255,0.08)" : "transparent" }}
          >
            <List size={13} style={{ color: view === "list" ? "#e2e8f0" : "rgba(255,255,255,0.35)" }} />
          </button>
        </div>
      </div>

      {/* Grid view */}
      {view === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((proj) => {
            const status = statusConfig[proj.status] ?? statusConfig.draft;
            return (
              <Link key={proj.id} href={`/projects/${proj.id}`}>
                <div className="glass rounded-2xl p-5 card-hover cursor-pointer h-full flex flex-col">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{
                        background: proj.type === "video"
                          ? "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(59,130,246,0.1))"
                          : "linear-gradient(135deg, rgba(124,58,237,0.2), rgba(99,102,241,0.1))",
                        border: proj.type === "video"
                          ? "1px solid rgba(6,182,212,0.2)"
                          : "1px solid rgba(124,58,237,0.2)",
                      }}>
                      {proj.type === "video"
                        ? <Video size={16} className="text-cyan-400" />
                        : <FileText size={16} className="text-violet-400" />}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={status.variant} className="text-3xs">{status.label}</Badge>
                      <button className="text-white/25 hover:text-white/50 transition-colors">
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                  </div>

                  <h3 className="text-sm font-bold text-white mb-1 line-clamp-1">{proj.name}</h3>
                  <div className="flex flex-wrap gap-1 mb-4">
                    {(proj.tags ?? []).map((t: string) => (
                      <span key={t} className="text-3xs px-1.5 py-0.5 rounded-md font-medium"
                        style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.35)" }}>
                        {t}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-4 mb-4 mt-auto">
                    {proj.content_count > 0 && (
                      <div className="flex items-center gap-1.5">
                        <FileText size={11} className="text-violet-400/60" />
                        <span className="text-xs text-white/50">{proj.content_count} posts</span>
                      </div>
                    )}
                    {proj.video_count > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Video size={11} className="text-cyan-400/60" />
                        <span className="text-xs text-white/50">{proj.video_count} videos</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 ml-auto">
                      <Zap size={11} className="text-amber-400/60" />
                      <span className="text-xs text-white/50">{formatNumber(proj.credits_used)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                    <div className="flex items-center gap-1 text-3xs text-white/30">
                      <Clock size={10} />
                      {formatRelative(proj.updated_at)}
                    </div>
                    <ArrowRight size={13} className="text-white/25" />
                  </div>
                </div>
              </Link>
            );
          })}

          <div className="rounded-2xl p-5 flex flex-col items-center justify-center cursor-pointer group transition-all min-h-[200px]"
            style={{ border: "1px dashed rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.01)" }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 transition-all group-hover:scale-105"
              style={{ background: "rgba(124,58,237,0.08)", border: "1px dashed rgba(124,58,237,0.2)" }}>
              <Plus size={18} className="text-violet-500/60 group-hover:text-violet-400 transition-colors" />
            </div>
            <p className="text-sm font-medium text-white/30 group-hover:text-white/50 transition-colors">New Project</p>
            <p className="text-3xs text-white/20 mt-1">Content or Video pipeline</p>
          </div>
        </div>
      ) : (
        /* List view */
        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                {["Name", "Type", "Status", "Content", "Videos", "Credits", "Updated"].map((h) => (
                  <th key={h} className="text-left py-3 px-4 text-3xs font-semibold uppercase tracking-wider text-white/30">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((proj) => {
                const status = statusConfig[proj.status] ?? statusConfig.draft;
                return (
                  <Link key={proj.id} href={`/projects/${proj.id}`} legacyBehavior>
                    <tr
                      className="hover:bg-white/[0.02] transition-colors cursor-pointer"
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: proj.type === "video" ? "rgba(6,182,212,0.1)" : "rgba(124,58,237,0.1)" }}>
                            {proj.type === "video"
                              ? <Video size={12} className="text-cyan-400" />
                              : <FileText size={12} className="text-violet-400" />}
                          </div>
                          <span className="text-sm text-white/75 font-medium">{proj.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs text-white/45 capitalize">{proj.type}</span>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={status.variant} className="text-3xs">{status.label}</Badge>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs text-white/45">{proj.content_count}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs text-white/45">{proj.video_count}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs text-white/45">{formatNumber(proj.credits_used)}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs text-white/30">{formatRelative(proj.updated_at)}</span>
                      </td>
                    </tr>
                  </Link>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="text-xs text-white/30 text-center py-12">No projects found.</p>
          )}
        </div>
      )}
    </div>
  );
}
