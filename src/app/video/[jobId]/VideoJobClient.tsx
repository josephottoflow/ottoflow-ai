"use client";

/**
 * VideoJobClient — ai-first render job view (Track B Task 3 + hardening pass).
 *
 * Topic → Strategy → AtlasCloud(scene_generations) → Compose → MP4, shown live.
 * Polls render_jobs + scene_generations via the Clerk-authed browser Supabase
 * client (~2.5s, RLS-scoped) until a terminal stage. All status is derived
 * through the single source of truth in @/lib/video/status.
 *
 * Hardening:
 *  - BOUNDED polling: auto-poll stops when a job is stuck (queued, no progress
 *    past the threshold) OR after a 10-min hard cap; a manual Refresh button
 *    takes over. A legitimately-progressing job keeps live-updating. This caps
 *    network/DB load in production (no tab polls forever).
 *  - Player hardening: scene tiles + final preview have loading + onError +
 *    fallback UI — never a blank black player.
 *
 * Read-only against the existing backend — no API/queue/Redis changes.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Film,
  FilmIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSupabase } from "@/components/SupabaseProvider";
import { deriveVideoJobStatus, type VideoJobStage } from "@/lib/video/status";
import type { DbRenderJob, DbSceneGeneration } from "@/lib/types";

interface Props {
  job: DbRenderJob;
  brand: { id: string; name: string } | null;
  scenes: DbSceneGeneration[];
}

/** Hard cap on auto-polling wall-clock for any non-terminal job. */
const MAX_POLL_MS = 10 * 60_000;

const STAGE_BADGE: Record<VideoJobStage, "secondary" | "info" | "warning" | "success" | "destructive"> = {
  queued: "secondary",
  generating: "warning",
  composing: "info",
  ready: "success",
  failed: "destructive",
};

const STEPS = ["Strategy", "Scenes", "Compose", "Ready"] as const;

function activeStep(stage: VideoJobStage, scenesDone: number, scenesTotal: number): number {
  switch (stage) {
    case "queued":
    case "generating":
      return 1;
    case "composing":
      return 2;
    case "ready":
      return 3;
    case "failed":
      return scenesDone >= scenesTotal && scenesTotal > 0 ? 2 : 1;
  }
}

function sceneUrl(s: DbSceneGeneration): string | null {
  // migration 022 added storage_url for ai-first; clip_url is the legacy field.
  return (s as { storage_url?: string | null }).storage_url ?? s.clip_url ?? null;
}

function elapsed(job: DbRenderJob): string {
  const start = Date.parse(job.started_at ?? job.created_at ?? "");
  if (!start) return "";
  const end = job.completed_at ? Date.parse(job.completed_at) : Date.now();
  const sec = Math.max(0, Math.round((end - start) / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export function VideoJobClient({ job: initialJob, brand, scenes: initialScenes }: Props) {
  const supabase = useSupabase();
  const [job, setJob] = useState<DbRenderJob>(initialJob);
  const [scenes, setScenes] = useState<DbSceneGeneration[]>(initialScenes);
  const [autoPaused, setAutoPaused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pollStartRef = useRef<number>(Date.now());

  const status = deriveVideoJobStatus(job, scenes);
  const terminal = status.stage === "ready" || status.stage === "failed";
  // Auto-poll stops on: terminal, stuck (queued w/ no progress), or manual pause.
  const stopped = terminal || status.isStuck || autoPaused;

  async function fetchNow(): Promise<void> {
    if (!supabase) return;
    const [{ data: j }, { data: s }] = await Promise.all([
      supabase.from("render_jobs").select("*").eq("id", job.id).maybeSingle(),
      supabase
        .from("scene_generations")
        .select("*")
        .eq("render_job_id", job.id)
        .order("scene_number", { ascending: true }),
    ]);
    if (j) setJob(j as DbRenderJob);
    if (s) setScenes(s as DbSceneGeneration[]);
  }

  useEffect(() => {
    if (!supabase || stopped) return;
    let active = true;
    const id = setInterval(async () => {
      if (!active) return;
      // Hard cap: stop auto-polling after MAX_POLL_MS regardless of stage.
      if (Date.now() - pollStartRef.current > MAX_POLL_MS) {
        setAutoPaused(true);
        return;
      }
      await fetchNow();
    }, 2500);
    return () => {
      active = false;
      clearInterval(id);
    };
    // fetchNow is stable enough for our purposes (reads job.id + supabase).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, job.id, stopped]);

  async function onManualRefresh() {
    setRefreshing(true);
    pollStartRef.current = Date.now();
    try {
      await fetchNow();
    } finally {
      setRefreshing(false);
      setAutoPaused(false); // resume auto-poll if the job is no longer stuck/terminal
    }
  }

  const step = activeStep(status.stage, status.scenesDone, status.scenesTotal);
  const playUrl = job.merged_video_url ?? null;
  const showRefresh = stopped && !terminal;

  return (
    <div className="min-h-screen text-white">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <Link href="/video/history" className="text-white/50 hover:text-white flex items-center gap-1.5 w-fit">
          <ArrowLeft size={14} />
          <span className="text-xs">History</span>
        </Link>

        {/* Header */}
        <header className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold">{job.name || "Video"}</h1>
            <Badge variant={STAGE_BADGE[status.stage]} className="text-3xs">{status.label}</Badge>
            {showRefresh && (
              <Button variant="outline" size="sm" className="gap-1.5 ml-auto" onClick={onManualRefresh} disabled={refreshing}>
                {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Refresh
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 text-2xs text-white/55 flex-wrap">
            {brand && <Link href={`/brands/${brand.id}`} className="hover:text-cyan-400">{brand.name}</Link>}
            <span>·</span><span>seedance</span>
            <span>·</span><span className="flex items-center gap-1"><Clock size={10} />{elapsed(job)}</span>
            {showRefresh && <><span>·</span><span className="text-amber-300/80">live updates paused</span></>}
          </div>
        </header>

        {/* Stuck banner */}
        {status.isStuck && (
          <div className="rounded-xl px-4 py-3 text-2xs flex items-start gap-2"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}>
            <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
            <span className="text-amber-200/90">{status.detail}</span>
          </div>
        )}

        {/* Progress */}
        <section className="space-y-2">
          <div className="flex items-center justify-between text-2xs text-white/60">
            <span>{status.detail}</span>
            <span>{status.progressPct}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div className="h-full rounded-full transition-all"
              style={{ width: `${status.progressPct}%`, background: status.isFailed ? "rgb(244,63,94)" : "linear-gradient(90deg,#22d3ee,#818cf8)" }} />
          </div>
        </section>

        {/* Stage stepper */}
        <section className="flex items-center gap-2">
          {STEPS.map((label, i) => {
            const state = status.isFailed && i === step ? "error" : i < step ? "done" : i === step ? "active" : "pending";
            return (
              <div key={label} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-7 h-7 rounded-full flex items-center justify-center"
                  style={{
                    background:
                      state === "done" ? "rgba(34,197,94,0.15)" :
                      state === "error" ? "rgba(244,63,94,0.15)" :
                      state === "active" ? "rgba(34,211,238,0.15)" : "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}>
                  {state === "done" ? <CheckCircle2 size={14} className="text-green-400" /> :
                   state === "error" ? <AlertCircle size={14} className="text-rose-400" /> :
                   state === "active" ? <Loader2 size={14} className="text-cyan-400 animate-spin" /> :
                   <span className="text-3xs text-white/30">{i + 1}</span>}
                </div>
                <span className={`text-3xs ${i <= step ? "text-white/70" : "text-white/30"}`}>{label}</span>
              </div>
            );
          })}
        </section>

        {/* Scene grid */}
        <section className="space-y-2">
          <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold">
            Scenes ({status.scenesDone}/{status.scenesTotal})
          </p>
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: status.scenesTotal }).map((_, i) => (
              <SceneTile
                key={i}
                index={i}
                url={scenes[i] ? sceneUrl(scenes[i]) : null}
                generating={!scenes[i] && status.stage === "generating" && i === status.scenesDone}
              />
            ))}
          </div>
        </section>

        {/* Preview + download (ready) */}
        {status.isReady && playUrl && (
          <section className="rounded-2xl overflow-hidden"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <PreviewPlayer url={playUrl} />
            <div className="px-4 py-3 border-t border-white/5">
              <a href={playUrl} download>
                <Button variant="gradient-cyan" size="sm" className="gap-1.5">
                  <Download size={13} /> Download MP4
                </Button>
              </a>
            </div>
          </section>
        )}

        {/* Failure state + retry (navigation only — no in-place re-enqueue) */}
        {status.isFailed && (
          <section className="rounded-2xl p-5 space-y-3"
            style={{ background: "rgba(244,63,94,0.05)", border: "1px solid rgba(244,63,94,0.2)" }}>
            <div className="flex items-start gap-2">
              <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white">Render failed</p>
                {status.failureReason && <p className="text-2xs text-rose-200/80 mt-1">{status.failureReason}</p>}
                <p className="text-3xs text-white/45 mt-1.5">This render can&apos;t be resumed — start a fresh one from the content item.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {brand && (
                <Link href={`/brands/${brand.id}`}>
                  <Button variant="secondary" size="sm" className="gap-1.5">
                    <RefreshCw size={13} /> Start a new render
                  </Button>
                </Link>
              )}
              <Link href="/content">
                <Button variant="outline" size="sm">Back to content</Button>
              </Link>
            </div>
          </section>
        )}

        {/* Queued empty hint (not a blank screen) */}
        {status.stage === "queued" && !status.isStuck && (
          <section className="rounded-2xl px-6 py-8 text-center"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)" }}>
            <Film size={26} className="text-white/30 mx-auto mb-3" />
            <p className="text-sm text-white/60">Queued — waiting for a worker to start your render.</p>
          </section>
        )}
      </div>
    </div>
  );
}

/** A single 9:16 scene tile with loading/error fallback (never a blank player). */
function SceneTile({ url, index, generating }: { url: string | null; index: number; generating: boolean }) {
  const [errored, setErrored] = useState(false);
  return (
    <div className="aspect-[9/16] rounded-lg overflow-hidden flex items-center justify-center"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
      {url && !errored ? (
        <video src={url} muted loop autoPlay playsInline preload="metadata"
          onError={() => setErrored(true)} className="w-full h-full object-cover" />
      ) : url && errored ? (
        <div className="flex flex-col items-center gap-1 text-white/30">
          <FilmIcon size={14} />
          <span className="text-3xs">scene {index + 1}</span>
        </div>
      ) : generating ? (
        <Loader2 size={16} className="text-cyan-400 animate-spin" />
      ) : (
        <span className="text-3xs text-white/25">{index + 1}</span>
      )}
    </div>
  );
}

/** Final MP4 player with a spinner until loaded + an error fallback. */
function PreviewPlayer({ url }: { url: string }) {
  const [errored, setErrored] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (errored) {
    return (
      <div className="aspect-[9/16] max-h-[70vh] mx-auto bg-black flex flex-col items-center justify-center gap-2 text-center px-6">
        <AlertCircle size={22} className="text-rose-400" />
        <p className="text-sm text-white/70">The video couldn&apos;t be loaded.</p>
        <a href={url} download className="text-2xs text-cyan-400 hover:underline">Try downloading it directly</a>
      </div>
    );
  }

  return (
    <div className="relative">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <Loader2 size={20} className="text-cyan-400 animate-spin" />
        </div>
      )}
      <video src={url} controls playsInline preload="metadata"
        onError={() => setErrored(true)} onLoadedData={() => setLoaded(true)}
        className="w-full aspect-[9/16] bg-black max-h-[70vh] object-contain mx-auto" />
    </div>
  );
}
