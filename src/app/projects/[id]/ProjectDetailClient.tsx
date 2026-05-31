"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ActivityFeed } from "@/components/ActivityFeed";
import { formatRelative, formatNumber } from "@/lib/utils";
import type { DbProject, DbContentItem, DbRenderJob, DbActivityItem } from "@/lib/types";
import {
  ArrowLeft, Video, FileText, MoreHorizontal, Play, Download,
  Send, Globe, Mail, BookOpen, Twitter, Linkedin, Facebook,
  BarChart3, Clock, Zap, TrendingUp, CheckCircle2, Eye,
  Image, Film, Mic, Plus, Settings2,
} from "lucide-react";

const platformIcons: Record<string, React.ElementType> = {
  linkedin: Linkedin, facebook: Facebook, instagram: Globe,
  twitter: Twitter, blog: BookOpen, email: Mail,
};

const platformColors: Record<string, string> = {
  linkedin: "#0a66c2", facebook: "#1877f2", instagram: "#e1306c",
  twitter: "#1da1f2", blog: "#a78bfa", email: "#34d399",
};

interface Props {
  project: DbProject;
  content: DbContentItem[];
  renderJobs: DbRenderJob[];
  activity: DbActivityItem[];
}

export function ProjectDetailClient({ project, content, renderJobs, activity }: Props) {
  const [tab, setTab] = useState("overview");

  const isVideo = project.type === "video";
  const accentColor = isVideo ? "#67e8f9" : "#a78bfa";

  return (
    <div className="p-6 max-w-[1400px] mx-auto">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <Link href="/projects">
          <button className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/60 transition-colors">
            <ArrowLeft size={12} />
            Projects
          </button>
        </Link>
        <span className="text-white/20">/</span>
        <span className="text-xs text-white/60">{project.name}</span>
      </div>

      {/* Project header */}
      <div className="glass rounded-2xl p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{
                background: isVideo
                  ? "linear-gradient(135deg, rgba(6,182,212,0.25), rgba(59,130,246,0.15))"
                  : "linear-gradient(135deg, rgba(124,58,237,0.25), rgba(99,102,241,0.15))",
                border: `1px solid ${isVideo ? "rgba(6,182,212,0.25)" : "rgba(124,58,237,0.25)"}`,
              }}>
              {isVideo
                ? <Video size={22} style={{ color: accentColor }} />
                : <FileText size={22} style={{ color: accentColor }} />}
            </div>

            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-xl font-bold text-white">{project.name}</h1>
                <Badge variant={project.status === "active" ? "success" : "secondary"} className="text-[10px] capitalize">
                  {project.status}
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span className="flex items-center gap-1.5">
                  {isVideo ? <Video size={11} /> : <FileText size={11} />}
                  {isVideo ? "Video Pipeline" : "Content Pipeline"} · {isVideo ? "Advanced" : "Basic"} Tier
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock size={11} />
                  Updated {formatRelative(project.updated_at)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Zap size={11} />
                  {formatNumber(project.credits_used)} credits used
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5 mt-3">
                {(project.tags ?? []).map((t: string) => (
                  <span key={t} className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                    style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <Settings2 size={13} />
              Settings
            </Button>
            <Button size="sm" className="gap-1.5 text-xs"
              style={{
                background: isVideo
                  ? "linear-gradient(135deg, #0891b2, #2563eb)"
                  : "linear-gradient(135deg, #7c3aed, #6366f1)",
                boxShadow: `0 4px 14px ${isVideo ? "rgba(6,182,212,0.25)" : "rgba(124,58,237,0.25)"}`,
              }}>
              <Play size={13} />
              Run Pipeline
            </Button>
            <button className="text-white/30 hover:text-white/50 transition-colors p-1.5">
              <MoreHorizontal size={16} />
            </button>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-3 mt-5 pt-5" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          {[
            { label: "Generated", value: isVideo ? project.video_count : project.content_count, icon: isVideo ? Video : FileText, color: accentColor },
            { label: "Published", value: content.filter((c) => c.status === "published").length, icon: Send, color: "#34d399" },
            { label: "Render Jobs", value: renderJobs.length, icon: TrendingUp, color: "#fb923c" },
            { label: "Credits", value: formatNumber(project.credits_used), icon: Zap, color: "#fbbf24" },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background: "rgba(255,255,255,0.02)" }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: `${s.color}15` }}>
                  <Icon size={14} style={{ color: s.color }} />
                </div>
                <div>
                  <div className="text-base font-bold text-white">{s.value}</div>
                  <div className="text-[10px] text-white/35">{s.label}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6 h-10 gap-1 p-1"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
          {["overview", "content", "videos", "assets", "analytics"].map((t) => (
            <TabsTrigger key={t} value={t} className="capitalize text-xs px-4 h-8">{t}</TabsTrigger>
          ))}
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
            <div className="space-y-4">
              <div className="glass rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-white">Recent Content</h3>
                  <Button variant="ghost" size="sm" className="text-xs h-7 text-white/40">View all</Button>
                </div>
                {content.length === 0 ? (
                  <p className="text-xs text-white/30 text-center py-6">No content yet.</p>
                ) : (
                  <div className="space-y-2">
                    {content.slice(0, 4).map((item) => {
                      const Icon = platformIcons[item.platform] ?? Globe;
                      const color = platformColors[item.platform] ?? "#a78bfa";
                      return (
                        <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.02] transition-colors"
                          style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: `${color}15` }}>
                            <Icon size={13} style={{ color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-white/70 truncate">{item.title}</p>
                            <p className="text-[10px] text-white/30 mt-0.5">{formatRelative(item.created_at)}</p>
                          </div>
                          <Badge
                            variant={item.status === "published" ? "success" : item.status === "draft" ? "secondary" : "warning"}
                            className="text-[9px]">
                            {item.status}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {isVideo && renderJobs.length > 0 && (
                <div className="glass rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-white">Video Files</h3>
                    <Button variant="ghost" size="sm" className="text-xs h-7 text-white/40">View all</Button>
                  </div>
                  <div className="space-y-2">
                    {renderJobs.slice(0, 3).map((job) => (
                      <div key={job.id} className="flex items-center gap-3 p-3 rounded-xl"
                        style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
                        <div className="w-14 h-9 rounded-lg flex-shrink-0 flex items-center justify-center"
                          style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.15), rgba(6,182,212,0.1))" }}>
                          <Video size={12} className="text-violet-400/60" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white/70 truncate">{job.name}</p>
                          <p className="text-[10px] text-white/30">{job.template}</p>
                        </div>
                        {job.output_url && (
                          <a href={job.output_url} download target="_blank" rel="noopener noreferrer">
                            <Button variant="ghost" size="icon" className="w-7 h-7 flex-shrink-0">
                              <Download size={12} className="text-white/30" />
                            </Button>
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="glass rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-white mb-4">Activity</h3>
              <ActivityFeed items={activity} />
            </div>
          </div>
        </TabsContent>

        {/* Content tab */}
        <TabsContent value="content">
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-semibold text-white">All Content</h3>
              <Button variant="gradient" size="sm" className="gap-1.5">
                <Plus size={13} /> Generate More
              </Button>
            </div>
            {content.length === 0 ? (
              <p className="text-xs text-white/30 text-center py-12">No content generated yet.</p>
            ) : (
              <div className="space-y-3">
                {content.map((item) => {
                  const Icon = platformIcons[item.platform] ?? Globe;
                  const color = platformColors[item.platform] ?? "#a78bfa";
                  const engagement = item.engagement as { likes?: number; shares?: number } | null;
                  return (
                    <div key={item.id} className="p-4 rounded-xl hover:bg-white/[0.015] transition-colors"
                      style={{ border: "1px solid rgba(255,255,255,0.05)" }}>
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{ background: `${color}15` }}>
                          <Icon size={14} style={{ color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-white/80">{item.title}</p>
                            <Badge variant={item.status === "published" ? "success" : item.status === "approved" ? "info" : "secondary"}
                              className="text-[10px] flex-shrink-0">
                              {item.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-white/40 mt-1 line-clamp-1">{item.preview}</p>
                          <div className="flex items-center gap-3 mt-2 text-[10px] text-white/30">
                            <span>{formatRelative(item.created_at)}</span>
                            {engagement?.likes && (
                              <span className="text-emerald-400/60">
                                {engagement.likes} likes · {engagement.shares} shares
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Videos tab */}
        <TabsContent value="videos">
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-semibold text-white">Generated Videos</h3>
              <Link href="/video/generate">
                <Button variant="gradient-cyan" size="sm" className="gap-1.5">
                  <Plus size={13} /> Generate Video
                </Button>
              </Link>
            </div>
            {renderJobs.length === 0 ? (
              <p className="text-xs text-white/30 text-center py-12">No videos yet.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                {renderJobs.map((job) => (
                  <div key={job.id} className="rounded-xl overflow-hidden group cursor-pointer"
                    style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="aspect-video flex items-center justify-center relative"
                      style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.15), rgba(6,182,212,0.08))" }}>
                      <Video size={20} className="text-violet-400/40" />
                      {job.status === "done" && (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ background: "rgba(0,0,0,0.5)" }}>
                          <div className="w-9 h-9 rounded-full flex items-center justify-center"
                            style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)" }}>
                            <Play size={14} className="text-white ml-0.5" />
                          </div>
                        </div>
                      )}
                      <Badge
                        variant={job.status === "done" ? "success" : job.status === "rendering" ? "info" : "warning"}
                        className="absolute top-2 right-2 text-[9px]">
                        {job.status}
                      </Badge>
                    </div>
                    <div className="p-2.5">
                      <p className="text-[11px] font-medium text-white/70 truncate">{job.name}</p>
                      <p className="text-[9px] text-white/30 mt-0.5">{job.template}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Assets tab */}
        <TabsContent value="assets">
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-semibold text-white">Project Assets</h3>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <Plus size={13} /> Upload
              </Button>
            </div>
            <div className="grid grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="aspect-square rounded-xl flex flex-col items-center justify-center p-3 cursor-pointer hover:bg-white/[0.03] transition-colors"
                  style={{ border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
                  {i < 3 ? (
                    <Image size={20} className="text-blue-400/50 mb-1.5" />
                  ) : i < 6 ? (
                    <Film size={20} className="text-violet-400/50 mb-1.5" />
                  ) : (
                    <Mic size={20} className="text-emerald-400/50 mb-1.5" />
                  )}
                  <span className="text-[9px] text-white/25 text-center">
                    {i < 3 ? `image-0${i + 1}.png` : i < 6 ? `clip-0${i - 2}.mp4` : `voice-0${i - 5}.mp3`}
                  </span>
                </div>
              ))}
              <div className="aspect-square rounded-xl flex flex-col items-center justify-center cursor-pointer"
                style={{ border: "1px dashed rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.01)" }}>
                <Plus size={18} className="text-white/20 mb-1" />
                <span className="text-[9px] text-white/20">Upload</span>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Analytics tab */}
        <TabsContent value="analytics">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {[
              { label: "Total Impressions", value: "48.2K", change: "+12.4%", color: "#a78bfa", icon: Eye },
              { label: "Engagements", value: "4,231", change: "+8.1%", color: "#34d399", icon: TrendingUp },
              { label: "Click-through Rate", value: "3.8%", change: "+0.4%", color: "#67e8f9", icon: BarChart3 },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="glass rounded-2xl p-5 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${s.color}15` }}>
                    <Icon size={20} style={{ color: s.color }} />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-white">{s.value}</div>
                    <div className="text-xs text-white/40">{s.label}</div>
                    <div className="text-[11px] text-emerald-400 mt-0.5">{s.change} this month</div>
                  </div>
                </div>
              );
            })}

            <div className="xl:col-span-3 glass rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-white mb-4">Performance Over Time</h3>
              <div className="h-40 flex items-end gap-2">
                {[35, 48, 42, 61, 58, 72, 68, 84, 79, 91, 88, 96, 102, 98].map((h, i) => (
                  <div key={i} className="flex-1 rounded-t-md"
                    style={{
                      height: `${(h / 102) * 100}%`,
                      background: `linear-gradient(to top, rgba(124,58,237,0.6), rgba(99,102,241,0.3))`,
                      minWidth: 0,
                    }} />
                ))}
              </div>
              <div className="flex justify-between mt-2 text-[9px] text-white/25">
                <span>May 1</span><span>May 15</span><span>May 30</span>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
