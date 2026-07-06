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
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deriveVideoJobStatus, type VideoJobStatus } from "@/lib/video/status";
import { toAppMediaUrl } from "@/lib/media-url";
import { SceneInspector, type SceneCandidate } from "@/components/SceneInspector";

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

  // Sprint 40 (launch QA) — Replace Visual is also reachable on the STOCK detail
  // view (this client), not only ai-first VideoJobClient. Root cause of the gap:
  // the inspector was mounted only in VideoJobClient, but stock videos render here.
  const [inspectScene, setInspectScene] = useState<number | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  async function handleReplace(sceneId: number, candidate: SceneCandidate) {
    setReplacing(true);
    setReplaceError(null);
    try {
      const res = await fetch(`/api/video/jobs/${job.id}/scene/${sceneId}/replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? `Replace failed (${res.status})`);
      window.location.reload();
    } catch (e) {
      setReplaceError(e instanceof Error ? e.message : "Replace failed");
    } finally {
      setReplacing(false);
    }
  }

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

  // Sprint 56 — this legacy (stock-first) detail view is server-rendered ONCE
  // and never re-fetched, so a queued/rendering job showed "Scenes 0" + the
  // "generation may have failed" empty state for its entire in-flight window
  // (confirmed live: a $0 Royalty-Free render sat here looking failed, then a
  // manual reload revealed a successful 6-scene video). Derive an honest
  // in-progress flag and, while in progress, softly re-fetch the server props
  // so the page advances to Ready on its own — no new backend, no new status
  // system (reuses job.status + Next's router.refresh, mirroring the bounded
  // polling the ai-first VideoJobClient already does).
  const isFailed = !videoReady && (job.status === "failed" || job.merge_status === "failed");
  const inProgress = !videoReady && !isFailed; // queued / rendering / merging
  // Sprint 57 — derive the customer-facing pipeline stage from the SAME single
  // source of truth the ai-first client uses (queued → generating[scenesDone/N]
  // → composing → ready/failed). These are the only stages the backend actually
  // exposes (render_jobs.status / merge_status / merged_video_url + one
  // scene_generations row per sourced clip); the compose sub-steps
  // (timeline/narration/music/encode/upload) are not separately observable, so
  // they honestly collapse into one "Building your video" stage — no invented
  // sub-stages, percentages, or ETAs.
  const vstatus = deriveVideoJobStatus(job, scenes);
  const isStock = (job as { scene_provider?: string | null }).scene_provider === "pexels";

  const router = useRouter();
  useEffect(() => {
    if (!inProgress) return;
    const startedAt = Date.now();
    const id = setInterval(() => {
      // Bounded: stop after 10 min so a genuinely stuck job doesn't refresh forever.
      if (Date.now() - startedAt > 10 * 60_000) {
        clearInterval(id);
        return;
      }
      router.refresh();
    }, 4000);
    return () => clearInterval(id);
  }, [inProgress, router]);

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
            ) : job.status === "rendering" ? (
              <Badge variant="info" className="text-3xs">Generating</Badge>
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
        ) : inProgress ? (
          <section
            className="rounded-2xl px-6 py-8"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)" }}
          >
            <div className="flex items-center justify-center gap-2 mb-5">
              {vstatus.stage === "queued" ? (
                <>
                  {/* Sprint 58 — the only real queue signal the backend exposes to a
                      customer is render_jobs.status: queued (waiting for a worker) vs
                      rendering. Surface it honestly; queue POSITION/length/ETA are not
                      exposed customer-side (BullMQ depth is admin-only), so they aren't
                      shown or faked. */}
                  <Clock size={16} className="text-amber-400" />
                  <p className="text-sm text-white/80">Waiting for the renderer</p>
                </>
              ) : (
                <>
                  <Loader2 size={16} className="text-cyan-400 animate-spin" />
                  <p className="text-sm text-white/80">Creating your video</p>
                </>
              )}
            </div>
            <GenerationStages status={vstatus} isStock={isStock} />
            <p className="text-2xs text-white/40 text-center mt-5">
              This can take a couple of minutes — it updates here automatically, no need to refresh.
            </p>
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
          <Stat label="Scenes" value={scenes.length ? String(scenes.length) : inProgress ? "…" : "0"} />
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
                  <button
                    type="button"
                    onClick={() =>
                      setInspectScene(inspectScene === s.scene_number ? null : s.scene_number)
                    }
                    className="mt-2 text-3xs font-medium text-cyan-400 hover:text-cyan-300"
                  >
                    {inspectScene === s.scene_number ? "Close" : "Replace visual"}
                  </button>
                  {inspectScene === s.scene_number && (
                    <div className="mt-2">
                      {replaceError && (
                        <p className="text-2xs text-amber-400 mb-1">{replaceError}</p>
                      )}
                      <SceneInspector
                        jobId={job.id}
                        sceneId={s.scene_number}
                        currentClipUrl={toAppMediaUrl(
                          (s as { storage_url?: string | null }).storage_url ?? s.clip_url ?? null,
                        )}
                        onReplace={(c) => handleReplace(s.scene_number, c)}
                        replacing={replacing}
                        onClose={() => setInspectScene(null)}
                      />
                    </div>
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

/**
 * Sprint 57 — customer-facing pipeline for an in-flight render. Every stage maps
 * 1:1 to a real backend signal derived by deriveVideoJobStatus; nothing is
 * faked. Stage 0 ("Story created") is always complete here because the
 * storyboard/strategy is composed in the studio BEFORE the job is queued
 * (persisted as render_jobs.video_strategy). The middle stage is provider-aware
 * (stock jobs source library footage; AI jobs generate scenes) and carries the
 * only granular signal the backend exposes — scenesDone/scenesTotal. Compose
 * (captions, brand, narration, music, encode, upload) is one backend step with
 * no per-substep signal, so it is one honest stage. No % and no ETA.
 */
function GenerationStages({ status, isStock }: { status: VideoJobStatus; isStock: boolean }) {
  const { stage, scenesDone, scenesTotal, isFailed } = status;
  // 0 = Story (always done on this page), 1 = Sourcing/Generating, 2 = Building, 3 = Ready.
  const active = stage === "ready" ? 3 : stage === "composing" ? 2 : 1;

  const footageLabel = isStock ? "Sourcing stock footage" : "Generating scenes";
  const footageSub =
    stage === "queued"
      ? "Waiting for the renderer to start"
      : stage === "generating" && scenesTotal > 0
        ? `${isStock ? "Clip" : "Scene"} ${Math.min(scenesDone + 1, scenesTotal)} of ${scenesTotal}`
        : scenesTotal > 0
          ? `${scenesTotal} ${isStock ? "clips" : "scenes"} ready`
          : isStock
            ? "Licensed footage from the library"
            : "AI-generated scenes";

  const steps = [
    { label: "Story created", sub: "Your storyboard is ready" },
    { label: footageLabel, sub: footageSub },
    { label: "Building your video", sub: "Captions, brand & music" },
    { label: "Ready", sub: "Preview & download" },
  ];

  return (
    <div className="space-y-3 max-w-sm mx-auto">
      {steps.map((s, i) => {
        const done = i < active || (stage === "ready" && i === active);
        const current = i === active && stage !== "ready" && !isFailed;
        const errored = isFailed && i === active;
        return (
          <div key={s.label} className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">
              {done ? (
                <CheckCircle2 size={16} className="text-green-400" />
              ) : errored ? (
                <AlertCircle size={16} className="text-rose-400" />
              ) : current ? (
                // queued = waiting for a worker (Clock), not actively working (spinner)
                stage === "queued" ? (
                  <Clock size={16} className="text-amber-400" />
                ) : (
                  <Loader2 size={16} className="text-cyan-400 animate-spin" />
                )
              ) : (
                <span className="block w-4 h-4 rounded-full border border-white/15" />
              )}
            </span>
            <div className="min-w-0">
              <p className={`text-sm leading-tight ${done ? "text-white/80" : current ? "text-white" : "text-white/35"}`}>
                {s.label}
              </p>
              {(current || done) && s.sub && (
                <p className="text-2xs text-white/45 mt-0.5">{s.sub}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
