"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Copy,
  Film,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Sparkles,
  Mic,
  Music,
  Type,
  Video,
  Layers,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DbRenderJob, DbSceneGeneration } from "@/lib/types";
import { toAppMediaUrl } from "@/lib/media-url";

interface Props {
  job: DbRenderJob;
  brand: { id: string; name: string } | null;
  scenes: DbSceneGeneration[];
}

function fmtMs(ms: number | null | undefined): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
function fmtUsd(usd: number | null | undefined): string {
  if (usd == null) return "free";
  return `$${usd.toFixed(2)}`;
}
function timeAgo(iso: string | undefined | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleString();
}

const PROVIDER_VARIANT: Record<string, "purple" | "info" | "success" | "warning" | "destructive"> = {
  runway: "purple",
  luma: "info",
  pexels: "success",
  failed: "destructive",
};

export function VideoDetailClient({ job, brand, scenes }: Props) {
  const script = job.script_json as
    | {
        hook?: string;
        body?: string;
        cta?: string;
        estimatedDurationSec?: number;
        voiceDirection?: string;
      }
    | null;
  const storyboard = job.storyboard_json as
    | {
        scenes?: { index: number; durationSec: number; shotType?: string; cameraMove?: string; description: string; voiceLine?: string }[];
        totalDurationSec?: number;
        aestheticNotes?: string;
      }
    | null;
  const seo = job.seo_json as
    | { title?: string; description?: string; hashtags?: string[] }
    | null;
  const overlay = job.overlay_json as
    | { keywords?: { text: string; start: number; end: number }[] }
    | null;

  const videoReady = !!job.merged_video_url;
  // App-owned URL so the customer never hits r2.dev (rate-limited / DNS-blocked
  // on some networks). Transforms legacy r2.dev rows at read-time too.
  const playUrl = toAppMediaUrl(job.merged_video_url ?? job.output_url ?? null);
  const totalGenMs = scenes.reduce(
    (acc, s) => acc + (s.generation_time_ms ?? 0),
    0,
  );
  const totalCostUsd = scenes.reduce(
    (acc, s) => acc + (s.cost_usd ?? 0),
    0,
  );
  const providersUsed = Array.from(
    new Set(scenes.map((s) => s.provider).filter(Boolean)),
  );

  return (
    <div className="min-h-screen text-white">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/video/history"
            className="text-white/50 hover:text-white transition-colors flex items-center gap-1.5"
          >
            <ArrowLeft size={14} />
            <span className="text-xs">History</span>
          </Link>
        </div>

        <header className="space-y-2">
          <div className="flex items-start gap-3 flex-wrap">
            <h1 className="text-xl font-bold">
              {seo?.title?.trim() || script?.hook?.trim() || job.name || "Video"}
            </h1>
            {videoReady ? (
              <Badge variant="success" className="text-3xs">Ready</Badge>
            ) : job.merge_status === "merging" ? (
              <Badge variant="info" className="text-3xs">Merging</Badge>
            ) : job.status === "failed" ? (
              <Badge variant="destructive" className="text-3xs">Failed</Badge>
            ) : (
              <Badge variant="warning" className="text-3xs">Queued</Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-2xs text-white/55 flex-wrap">
            {brand && (
              <Link href={`/brands/${brand.id}`} className="hover:text-cyan-400">
                {brand.name}
              </Link>
            )}
            {job.style && (<><span>·</span><span>{job.style}</span></>)}
            {providersUsed.length > 0 && (
              <>
                <span>·</span>
                <span>{providersUsed.join(" + ")}</span>
              </>
            )}
            {scenes.length > 0 && (<><span>·</span><span>{scenes.length} scenes</span></>)}
            {storyboard?.totalDurationSec && (
              <><span>·</span><span>{storyboard.totalDurationSec}s</span></>
            )}
            <span>·</span><span>{timeAgo(job.created_at ?? job.started_at)}</span>
          </div>
        </header>

        {/* Final video player */}
        {playUrl ? (
          <section
            className="glass rounded-2xl overflow-hidden"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <video
              src={playUrl}
              controls
              muted
              playsInline
              className="w-full aspect-video bg-black max-h-[70vh] object-contain"
            />
            <div className="px-4 py-3 flex items-center gap-2 flex-wrap border-t border-white/5">
              {videoReady && (
                <a href={playUrl} download>
                  <Button variant="gradient-cyan" size="sm" className="gap-1.5">
                    <Download size={13} />
                    Download (with audio + overlays)
                  </Button>
                </a>
              )}
              <Link href="/video/start">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Sparkles size={13} />
                  New video
                </Button>
              </Link>
              {job.video_attribution && (
                <p className="text-3xs text-white/40 ml-auto">
                  Stock · {job.video_attribution}
                </p>
              )}
            </div>
          </section>
        ) : (
          <section
            className="rounded-2xl px-6 py-8 text-center"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)" }}
          >
            <Film size={28} className="text-white/30 mx-auto mb-3" />
            <p className="text-sm text-white/60">
              No playable video URL — generation may have failed.
            </p>
          </section>
        )}

        {/* Generation summary */}
        <section
          className="rounded-2xl p-5 grid grid-cols-2 sm:grid-cols-4 gap-4"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <Stat label="Scenes" value={String(scenes.length || 0)} />
          <Stat label="Provider mix" value={providersUsed.join(" + ") || "—"} />
          <Stat label="AI gen time" value={fmtMs(totalGenMs)} />
          <Stat label="AI cost" value={fmtUsd(totalCostUsd)} />
        </section>

        {/* Scene breakdown */}
        {scenes.length > 0 && (
          <section className="space-y-2">
            <SectionHeader icon={Layers} label="Scene breakdown" count={scenes.length} />
            <div className="space-y-2">
              {scenes.map((s) => (
                <div
                  key={s.id}
                  className="rounded-xl p-4"
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <Badge variant="purple" className="text-3xs">
                      Scene {s.scene_number}
                    </Badge>
                    <Badge variant={PROVIDER_VARIANT[s.provider] ?? "purple"} className="text-3xs">
                      {s.provider}
                    </Badge>
                    {s.shot_type && (
                      <span className="text-3xs text-white/40 uppercase tracking-wider">
                        {s.shot_type}
                      </span>
                    )}
                    <span className="text-3xs text-white/40 ml-auto flex items-center gap-1.5">
                      <Clock size={10} />
                      {fmtMs(s.generation_time_ms)} · {fmtUsd(s.cost_usd)}
                    </span>
                  </div>
                  <p className="text-xs text-white/75 leading-relaxed mb-1">
                    {s.prompt}
                  </p>
                  {s.fallback_reason && (
                    <p className="text-2xs text-rose-300/80 flex items-start gap-1.5">
                      <AlertCircle size={11} className="shrink-0 mt-0.5" />
                      <span>Fallback: {s.fallback_reason.slice(0, 200)}</span>
                    </p>
                  )}
                  {s.attribution && (
                    <p className="text-3xs text-white/35 mt-1">
                      {s.attribution}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Script */}
        {script && (
          <section className="space-y-2">
            <SectionHeader icon={Type} label="Script" />
            <div
              className="rounded-xl p-5 space-y-3"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              {script.hook && (
                <SubSection label="Hook">
                  <p className="text-sm text-white italic font-semibold">
                    &ldquo;{script.hook}&rdquo;
                  </p>
                </SubSection>
              )}
              {script.body && (
                <SubSection label="Body">
                  <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">
                    {script.body}
                  </p>
                </SubSection>
              )}
              {script.cta && (
                <SubSection label="CTA">
                  <p className="text-sm text-white/85 leading-snug">
                    {script.cta}
                  </p>
                </SubSection>
              )}
              {script.voiceDirection && (
                <SubSection label="Voice direction">
                  <p className="text-2xs text-white/55">{script.voiceDirection}</p>
                </SubSection>
              )}
            </div>
          </section>
        )}

        {/* Storyboard */}
        {storyboard?.scenes && storyboard.scenes.length > 0 && (
          <section className="space-y-2">
            <SectionHeader icon={Film} label="Storyboard" count={storyboard.scenes.length} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {storyboard.scenes.map((sc) => (
                <div
                  key={sc.index}
                  className="rounded-xl p-3"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Badge variant="info" className="text-3xs">
                      Scene {sc.index}
                    </Badge>
                    <span className="text-3xs text-white/40">
                      {sc.durationSec}s · {sc.shotType}
                    </span>
                  </div>
                  <p className="text-xs text-white/70 leading-snug">
                    {sc.description}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Overlay timeline */}
        {overlay?.keywords && overlay.keywords.length > 0 && (
          <section className="space-y-2">
            <SectionHeader icon={Zap} label="Keyword overlays" count={overlay.keywords.length} />
            <div
              className="rounded-xl p-4 flex flex-wrap gap-1.5"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              {overlay.keywords.map((k, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-fuchsia-500/10 text-fuchsia-200 text-2xs font-bold tracking-wider border border-fuchsia-500/20"
                >
                  {k.text}
                  <span className="text-3xs text-fuchsia-300/60 font-normal tracking-normal">
                    {k.start.toFixed(1)}s
                  </span>
                </span>
              ))}
            </div>
          </section>
        )}

        {/* SEO copy */}
        {seo && (
          <section className="space-y-2">
            <SectionHeader icon={Sparkles} label="Post copy" />
            <div
              className="rounded-xl p-5 space-y-3"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              {seo.title && (
                <SubSection label="Title">
                  <p className="text-sm text-white font-semibold">{seo.title}</p>
                </SubSection>
              )}
              {seo.description && (
                <SubSection label="Description">
                  <p className="text-sm text-white/75 leading-relaxed whitespace-pre-wrap">
                    {seo.description}
                  </p>
                </SubSection>
              )}
              {seo.hashtags && seo.hashtags.length > 0 && (
                <SubSection label="Hashtags">
                  <div className="flex flex-wrap gap-1.5">
                    {seo.hashtags.map((tag) => (
                      <span
                        key={tag}
                        className="text-2xs px-2 py-0.5 rounded-full bg-white/[0.04] text-white/70"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </SubSection>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  label,
  count,
}: {
  icon: typeof Film;
  label: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={14} className="text-cyan-400" />
      <h2 className="text-sm font-bold text-white">{label}</h2>
      {count != null && (
        <span className="text-3xs text-white/40 font-medium">({count})</span>
      )}
    </div>
  );
}

function SubSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-1">
        {label}
      </p>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-1">
        {label}
      </p>
      <p className="text-sm text-white font-semibold truncate">{value}</p>
    </div>
  );
}
