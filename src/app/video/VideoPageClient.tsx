"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KPICard } from "@/components/KPICard";
import { RenderQueue } from "@/components/RenderQueue";
import { formatNumber } from "@/lib/utils";
import type { DbRenderJob, KPISummary } from "@/lib/types";
import {
  Video,
  Zap,
  Play,
  Pause,
  Check,
  Sparkles,
  Settings2,
  FileVideo,
  Film,
  Image,
  Wand2,
  Download,
  RefreshCw,
  DollarSign,
  Cpu,
} from "lucide-react";
import Link from "next/link";

const videoPipelineSteps = [
  { id: 1, label: "Creative Brief", desc: "Product, audience, goal", done: true },
  { id: 2, label: "Script Generator", desc: "AI writes hook + body + CTA", done: true },
  { id: 3, label: "Storyboard Builder", desc: "Scene-by-scene visual plan", done: true, active: true },
  { id: 4, label: "Prompt Generator", desc: "Cinematic video prompts", done: false },
  { id: 5, label: "Higgsfield Director", desc: "Camera motion & direction", done: false },
  { id: 6, label: "Veo 3 Rendering", desc: "AI video clip generation", done: false },
  { id: 7, label: "Voice Generation", desc: "ElevenLabs narration", done: false },
  { id: 8, label: "Caption Generation", desc: "Auto subtitles & styling", done: false },
  { id: 9, label: "Final Export", desc: "Merge, grade, deliver", done: false },
];

const outputFormats = [
  { label: "Product Ads", icon: Film, count: 14, color: "#a78bfa" },
  { label: "UGC Videos", icon: Video, count: 12, color: "#67e8f9" },
  { label: "Social Reels", icon: FileVideo, count: 8, color: "#34d399" },
  { label: "TikTok", icon: Play, count: 5, color: "#fb923c" },
  { label: "Facebook Ads", icon: Image, count: 2, color: "#60a5fa" },
];

const providers = [
  { id: "veo3", label: "Veo 3 Lite", desc: "Google DeepMind · 4-8s clips", badge: "Best Quality", badgeColor: "#a78bfa" },
  { id: "higgsfield", label: "Higgsfield AI", desc: "Camera motion control · Cinematic", badge: "Director Mode", badgeColor: "#67e8f9" },
  { id: "imagen3", label: "Imagen 3", desc: "Static frames · Fast fallback", badge: "Fastest", badgeColor: "#34d399" },
];

interface Props {
  renderJobs: DbRenderJob[];
  kpis: KPISummary;
}

export function VideoPageClient({ renderJobs, kpis }: Props) {
  const [selectedProvider, setSelectedProvider] = useState("veo3");

  const activeJobs = renderJobs.filter((j) => j.status === "rendering").length;
  const pendingJobs = renderJobs.filter((j) => j.status !== "done").length;
  const completedJobs = renderJobs.filter((j) => j.status === "done");

  return (
    <div className="p-6 max-w-[1400px] mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.3), rgba(59,130,246,0.2))", border: "1px solid rgba(6,182,212,0.3)" }}>
              <Video size={12} className="text-cyan-400" />
            </div>
            <span className="text-xs font-medium text-cyan-400">Video Pipeline</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Video Generation</h1>
          <p className="text-white/40 text-sm mt-1">AI-powered video factory · Higgsfield + Veo 3 Lite + ElevenLabs</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/settings">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Settings2 size={14} />
              Configure
            </Button>
          </Link>
          <Link href="/video/generate">
            <Button variant="gradient-cyan" size="sm" className="gap-1.5">
              <Sparkles size={14} />
              Generate Video
            </Button>
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Active Renders"
          value={activeJobs}
          subtitle={`${pendingJobs} jobs total queued`}
          icon={<Cpu size={18} />}
          iconColor="#67e8f9"
          iconBg="rgba(6,182,212,0.12)"
        />
        <KPICard
          title="Videos Generated"
          value={formatNumber(kpis.totalVideos)}
          subtitle="Completed"
          icon={<Video size={18} />}
          iconColor="#a78bfa"
          iconBg="rgba(124,58,237,0.12)"
        />
        <KPICard
          title="Render Credits"
          value={formatNumber(kpis.creditsTotal - kpis.creditsUsed)}
          subtitle="Available to use"
          icon={<Zap size={18} />}
          iconColor="#fbbf24"
          iconBg="rgba(245,158,11,0.12)"
        />
        <KPICard
          title="Est. Render Cost"
          value={`$${(pendingJobs * 1.60).toFixed(2)}`}
          subtitle="For current queue"
          icon={<DollarSign size={18} />}
          iconColor="#34d399"
          iconBg="rgba(16,185,129,0.12)"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">

        {/* Left panel */}
        <div className="space-y-4">
          {/* Pipeline flow */}
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Video Workflow</h2>
              <Button variant="ghost" size="icon" className="w-7 h-7">
                <RefreshCw size={13} className="text-white/40" />
              </Button>
            </div>

            <div className="space-y-0.5">
              {videoPipelineSteps.map((step, i) => (
                <div key={step.id} className="relative">
                  <div
                    className="flex items-start gap-2.5 p-2.5 rounded-lg transition-colors"
                    style={{
                      background: step.active ? "rgba(6,182,212,0.08)" : step.done ? "rgba(255,255,255,0.015)" : "transparent",
                      border: step.active ? "1px solid rgba(6,182,212,0.18)" : "1px solid transparent",
                    }}
                  >
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold"
                      style={{
                        background: step.done ? "rgba(16,185,129,0.15)" : step.active ? "rgba(6,182,212,0.2)" : "rgba(255,255,255,0.05)",
                        color: step.done ? "#34d399" : step.active ? "#67e8f9" : "rgba(255,255,255,0.25)",
                      }}>
                      {step.done && !step.active ? <Check size={9} /> : step.id}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[11px] font-semibold"
                          style={{ color: step.active ? "#67e8f9" : step.done ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.25)" }}>
                          {step.label}
                        </p>
                        {step.active && (
                          <span className="text-[8px] px-1 py-0.5 rounded font-bold"
                            style={{ background: "rgba(6,182,212,0.15)", color: "#67e8f9" }}>
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="text-[9px] text-white/25">{step.desc}</p>
                    </div>
                  </div>
                  {i < videoPipelineSteps.length - 1 && (
                    <div className="absolute left-[18px] top-[38px] w-px h-3 bg-white/6" />
                  )}
                </div>
              ))}
            </div>

            <Button variant="gradient-cyan" className="w-full mt-4 gap-2 text-sm" size="sm" disabled title="Pipeline progression requires the video worker (v1)">
              <Play size={13} />
              Continue Pipeline
              <Badge variant="info" className="text-[9px] ml-1">Soon</Badge>
            </Button>
          </div>

          {/* Provider select */}
          <div className="glass rounded-2xl p-4">
            <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-3">AI Provider</h3>
            <div className="space-y-2">
              {providers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProvider(p.id)}
                  className="w-full flex items-start gap-3 p-2.5 rounded-xl text-left transition-all"
                  style={{
                    background: selectedProvider === p.id ? "rgba(6,182,212,0.06)" : "rgba(255,255,255,0.02)",
                    border: selectedProvider === p.id ? "1px solid rgba(6,182,212,0.2)" : "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                    style={{ background: selectedProvider === p.id ? "#67e8f9" : "rgba(255,255,255,0.2)" }} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold" style={{ color: selectedProvider === p.id ? "#e2e8f0" : "rgba(255,255,255,0.5)" }}>
                        {p.label}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                        style={{ background: "rgba(255,255,255,0.06)", color: p.badgeColor }}>
                        {p.badge}
                      </span>
                    </div>
                    <p className="text-[10px] text-white/30 mt-0.5">{p.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Output formats */}
          <div className="glass rounded-2xl p-4">
            <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-3">Output Types</h3>
            <div className="space-y-2">
              {outputFormats.map((f) => {
                const Icon = f.icon;
                return (
                  <div key={f.label} className="flex items-center gap-2.5 p-2 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.02)" }}>
                    <Icon size={13} style={{ color: f.color }} />
                    <span className="text-xs text-white/55 flex-1">{f.label}</span>
                    <span className="text-xs font-bold" style={{ color: f.color }}>{f.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Queue + Output */}
        <div className="space-y-4">
          {/* Render queue */}
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Render Queue</h2>
                <p className="text-[11px] text-white/35 mt-0.5">
                  {activeJobs} active · {pendingJobs - activeJobs} queued
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7 gap-1.5 text-white/40"
                  disabled={activeJobs === 0}
                  title={
                    activeJobs === 0
                      ? "No active renders to pause"
                      : "Pause every running render"
                  }
                >
                  <Pause size={12} /> Pause all
                </Button>
              </div>
            </div>
            <RenderQueue jobs={renderJobs} />
          </div>

          {/* Completed videos */}
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Completed Videos</h2>
              <Badge variant="success" className="text-[10px]">{completedJobs.length} files</Badge>
            </div>

            {completedJobs.length === 0 ? (
              <p className="text-xs text-white/30 text-center py-8">No completed videos yet.</p>
            ) : (
              <div className="space-y-2">
                {completedJobs.map((v) => (
                  <div key={v.id}
                    className="flex items-center gap-3 p-3 rounded-xl"
                    style={{ border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.015)" }}>
                    <div className="w-16 h-10 rounded-lg flex-shrink-0 flex items-center justify-center"
                      style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.15), rgba(6,182,212,0.1))" }}>
                      <Video size={14} className="text-violet-400/60" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white/75 truncate">{v.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-white/35">{v.template}</span>
                        {v.duration_ms && (
                          <>
                            <span className="text-[10px] text-white/25">·</span>
                            <span className="text-[10px] text-white/35">
                              {(v.duration_ms / 1000).toFixed(1)}s render
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    {v.output_url && (
                      <a href={v.output_url} download target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="icon" className="w-7 h-7 flex-shrink-0">
                          <Download size={13} className="text-white/40" />
                        </Button>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick prompt */}
          <div className="glass rounded-2xl p-5 relative overflow-hidden"
            style={{ border: "1px solid rgba(6,182,212,0.12)" }}>
            <div className="absolute inset-0 opacity-30"
              style={{ background: "radial-gradient(ellipse at top right, rgba(6,182,212,0.1) 0%, transparent 60%)" }} />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <Wand2 size={14} className="text-cyan-400" />
                <h3 className="text-sm font-semibold text-white">Quick Generate</h3>
                <Badge variant="info" className="text-[10px] ml-auto">New</Badge>
              </div>
              <p className="text-xs text-white/45 mb-4 leading-relaxed">
                Generate a UGC video from a single prompt. AI handles script, storyboard, clips, voiceover, and captions automatically.
              </p>
              <Link href="/video/generate">
                <Button variant="gradient-cyan" className="w-full gap-2" size="sm">
                  <Sparkles size={13} />
                  Open Video Studio
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
