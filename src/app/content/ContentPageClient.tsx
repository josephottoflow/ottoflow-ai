"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KPICard } from "@/components/KPICard";
import { formatRelative, formatNumber } from "@/lib/utils";
import type { DbContentItem, KPISummary } from "@/lib/types";
import {
  FileText,
  Zap,
  Play,
  Check,
  Clock,
  Send,
  Plus,
  ChevronRight,
  Globe,
  Mail,
  BookOpen,
  Twitter,
  Linkedin,
  Facebook,
  ArrowRight,
  Sparkles,
  RefreshCw,
  Settings2,
} from "lucide-react";

const workflowSteps = [
  { id: 1, label: "Business Info", desc: "Brand voice, tone, audience", done: true },
  { id: 2, label: "Brand Analysis", desc: "Analyze existing content style", done: true },
  { id: 3, label: "Research Agent", desc: "Competitor & topic research", done: true },
  { id: 4, label: "Content Strategy", desc: "Topic clusters & calendar", done: true, active: true },
  { id: 5, label: "Generation", desc: "AI drafts multi-platform", done: false },
  { id: 6, label: "Approval", desc: "Review & edit drafts", done: false },
  { id: 7, label: "Publishing", desc: "Schedule & publish", done: false },
];

const platformConfig: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  linkedin: { label: "LinkedIn", icon: Linkedin, color: "#0a66c2", bg: "rgba(10,102,194,0.12)" },
  facebook: { label: "Facebook", icon: Facebook, color: "#1877f2", bg: "rgba(24,119,242,0.12)" },
  instagram: { label: "Instagram", icon: Globe, color: "#e1306c", bg: "rgba(225,48,108,0.12)" },
  twitter: { label: "X / Twitter", icon: Twitter, color: "#1da1f2", bg: "rgba(29,161,242,0.12)" },
  blog: { label: "Blog Article", icon: BookOpen, color: "#a78bfa", bg: "rgba(124,58,237,0.12)" },
  email: { label: "Email", icon: Mail, color: "#34d399", bg: "rgba(16,185,129,0.12)" },
};

const statusConfig: Record<string, { label: string; variant: "secondary" | "success" | "info" | "warning" }> = {
  draft: { label: "Draft", variant: "secondary" },
  approved: { label: "Approved", variant: "success" },
  published: { label: "Published", variant: "info" },
  scheduled: { label: "Scheduled", variant: "warning" },
};

interface Props {
  items: DbContentItem[];
  kpis: KPISummary;
}

export function ContentPageClient({ items, kpis }: Props) {
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const filtered = activeFilter === "all"
    ? items
    : items.filter((c) => c.status === activeFilter || c.platform === activeFilter);

  const draftCount = items.filter((c) => c.status === "draft").length;
  const publishedCount = items.filter((c) => c.status === "published").length;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.3), rgba(99,102,241,0.2))", border: "1px solid rgba(124,58,237,0.3)" }}>
              <FileText size={12} className="text-violet-400" />
            </div>
            <span className="text-xs font-medium text-violet-400">Content Pipeline</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Content Generation</h1>
          <p className="text-white/40 text-sm mt-1">AI-powered multi-platform content automation · Gemini Flash Lite</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/settings">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Settings2 size={14} />
              Configure
            </Button>
          </Link>
          <Button variant="gradient" size="sm" className="gap-1.5" disabled title="Content worker coming with v1">
            <Sparkles size={14} />
            Run Pipeline
            <Badge variant="info" className="text-[9px] ml-1">Soon</Badge>
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Total Generated"
          value={formatNumber(kpis.totalContent)}
          subtitle="All time"
          icon={<FileText size={18} />}
          iconColor="#a78bfa"
          iconBg="rgba(124,58,237,0.12)"
        />
        <KPICard
          title="Credits Left"
          value={formatNumber(kpis.creditsTotal - kpis.creditsUsed)}
          subtitle={`of ${formatNumber(kpis.creditsTotal)} total`}
          icon={<Zap size={18} />}
          iconColor="#fbbf24"
          iconBg="rgba(245,158,11,0.12)"
        />
        <KPICard
          title="Published"
          value={publishedCount}
          subtitle="Across all platforms"
          icon={<Send size={18} />}
          iconColor="#34d399"
          iconBg="rgba(16,185,129,0.12)"
        />
        <KPICard
          title="Pending Review"
          value={draftCount}
          subtitle="Awaiting approval"
          icon={<Clock size={18} />}
          iconColor="#fb923c"
          iconBg="rgba(251,146,60,0.12)"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-6">

        {/* Left: Workflow */}
        <div className="space-y-4">
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Pipeline Workflow</h2>
              <Button variant="ghost" size="icon" className="w-7 h-7">
                <RefreshCw size={13} className="text-white/40" />
              </Button>
            </div>

            <div className="space-y-1">
              {workflowSteps.map((step, i) => (
                <div key={step.id} className="relative">
                  <div
                    className="flex items-start gap-3 p-3 rounded-xl transition-colors"
                    style={{
                      background: step.active
                        ? "rgba(124,58,237,0.1)"
                        : step.done ? "rgba(255,255,255,0.02)" : "transparent",
                      border: step.active ? "1px solid rgba(124,58,237,0.2)" : "1px solid transparent",
                    }}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold"
                      style={{
                        background: step.done ? "rgba(16,185,129,0.2)" : step.active ? "rgba(124,58,237,0.3)" : "rgba(255,255,255,0.06)",
                        color: step.done ? "#34d399" : step.active ? "#a78bfa" : "rgba(255,255,255,0.3)",
                        border: step.active ? "1px solid rgba(124,58,237,0.4)" : "1px solid transparent",
                      }}
                    >
                      {step.done && !step.active ? <Check size={11} /> : step.id}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold"
                          style={{ color: step.active ? "#a78bfa" : step.done ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.3)" }}>
                          {step.label}
                        </p>
                        {step.active && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                            style={{ background: "rgba(124,58,237,0.2)", color: "#a78bfa" }}>
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-white/30 mt-0.5">{step.desc}</p>
                    </div>
                  </div>
                  {i < workflowSteps.length - 1 && (
                    <div className="absolute left-[21px] top-[42px] w-px h-4 bg-white/8" />
                  )}
                </div>
              ))}
            </div>

            <Button variant="gradient" className="w-full mt-4 gap-2" size="sm" disabled title="Pipeline progression requires the content worker (v1)">
              <Play size={13} />
              Continue Pipeline
              <Badge variant="info" className="text-[9px] ml-1">Soon</Badge>
            </Button>
          </div>

          {/* Platform breakdown */}
          <div className="glass rounded-2xl p-4">
            <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-3">Output Platforms</h3>
            <div className="space-y-2">
              {Object.entries(platformConfig).map(([key, cfg]) => {
                const Icon = cfg.icon;
                const count = items.filter((c) => c.platform === key).length;
                return (
                  <div key={key} className="flex items-center gap-3 p-2 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.02)" }}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: cfg.bg }}>
                      <Icon size={13} style={{ color: cfg.color }} />
                    </div>
                    <span className="text-xs text-white/60 flex-1">{cfg.label}</span>
                    <span className="text-xs font-semibold text-white/40">{count}</span>
                    {count > 0 && <Check size={11} className="text-emerald-400" />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Content list */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Generated Content</h2>
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {["all", "draft", "approved", "published"].map((f) => (
                  <button
                    key={f}
                    onClick={() => setActiveFilter(f)}
                    className="text-[10px] font-medium px-2.5 py-1 rounded-full capitalize transition-all"
                    style={{
                      background: activeFilter === f ? "rgba(124,58,237,0.15)" : "rgba(255,255,255,0.05)",
                      color: activeFilter === f ? "#a78bfa" : "rgba(255,255,255,0.4)",
                      border: activeFilter === f ? "1px solid rgba(124,58,237,0.25)" : "1px solid transparent",
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <Button variant="ghost" size="icon" className="w-7 h-7">
                <Plus size={14} className="text-white/40" />
              </Button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-white/30 text-sm">No content items yet.</p>
              <p className="text-white/20 text-xs mt-1">Run the pipeline to generate content.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((item) => {
                const platform = platformConfig[item.platform] ?? platformConfig.blog;
                const Icon = platform.icon;
                const status = statusConfig[item.status] ?? statusConfig.draft;
                const engagement = item.engagement as { likes?: number; shares?: number } | null;
                return (
                  <div
                    key={item.id}
                    className="p-4 rounded-xl cursor-pointer transition-all hover:bg-white/[0.02]"
                    style={{ border: "1px solid rgba(255,255,255,0.05)" }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center mt-0.5"
                        style={{ background: platform.bg }}>
                        <Icon size={14} style={{ color: platform.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-sm font-medium text-white/80 leading-snug">{item.title}</p>
                          <Badge variant={status.variant} className="text-[10px] flex-shrink-0">{status.label}</Badge>
                        </div>
                        <p className="text-xs text-white/40 line-clamp-2 leading-relaxed">{item.preview}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-[10px] text-white/25">{formatRelative(item.created_at)}</span>
                          <span className="text-[10px] text-white/25">{platform.label}</span>
                          {engagement?.likes && (
                            <span className="text-[10px] text-emerald-400/70">
                              {engagement.likes} likes · {engagement.shares} shares
                            </span>
                          )}
                        </div>
                      </div>
                      <button className="text-white/20 hover:text-white/50 transition-colors mt-0.5">
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <button
            className="w-full mt-3 py-3 text-xs text-white/20 transition-colors text-center cursor-not-allowed"
            disabled
            title="Pagination arrives with the content worker (v1)"
          >
            Load more content
          </button>
        </div>
      </div>
    </div>
  );
}
