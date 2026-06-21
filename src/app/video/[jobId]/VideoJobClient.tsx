"use client";

/**
 * VideoJobClient — ai-first render job view (Track B Task 3).
 *
 * Topic → Strategy → AtlasCloud(scene_generations) → Compose → MP4, shown live.
 * Polls render_jobs + scene_generations via the Clerk-authed browser Supabase
 * client (~2.5s, RLS-scoped) until a terminal stage — the documented reliable
 * fallback to Realtime on content tables. All status is derived through the
 * single source of truth in @/lib/video/status (no per-screen status logic).
 *
 * Sections: header + status badge · progress · stage stepper · scene grid ·
 * preview player + download · failure state + retry · stuck banner. Read-only
 * against the existing backend — no API/queue/Redis changes.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Film,
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

  const status = deriveVideoJobStatus(job, scenes);
  const terminal = status.stage === "ready" || status.stage === "failed";

  // Poll until terminal (effect re-runs when stage flips and then bails out).
  useEffect(() => {
    if (!supabase || terminal) return;
    let active = true;
    const tick = async () => {
      const [{ data: j }, { data: s }] = await Promise.all([
        supabase.from("render_jobs").select("*").eq("id", job.id).maybeSingle(),
        supabase
          .from("scene_generations")
          .select("*")
          .eq("render_job_id", job.id)
          .order("scene_number", { ascending: true }),
      ]);
      if (!active) return;
      if (j) setJob(j as DbRenderJob);
      if (s) setScenes(s as DbSceneGeneration[]);
    };
    const id = setInterval(tick, 2500);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [supabase, job.id, terminal]);

  const step = activeStep(status.stage, status.scenesDone, status.scenesTotal);
  const playUrl = job.merged_video_url ?? null;

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
          </div>
          <div className="flex items-center gap-2 text-2xs text-white/55 flex-wrap">
            {brand && (
              <Link href={`/brands/${brand.id}`} className="hover:text-cyan-400">{brand.name}</Link>
            )}
            <span>·</span><span>seedance</span>
            <span>·</span><span className="flex items-center gap-1"><Clock size={10} />{elapsed(job)}</span>
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

        {/* Progress + status detail */}
        <section className="space-y-2">
          <div className="flex items-center justify-between text-2xs text-white/60">
            <span>{status.detail}</span>
            <span>{status.progressPct}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${status.progressPct}%`,
                background: status.isFailed ? "rgb(244,63,94)" : "linear-gradient(90deg,#22d3ee,#818cf8)",
              }}
            />
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
            {Array.from({ length: status.scenesTotal }).map((_, i) => {
              const s = scenes[i];
              const url = s ? sceneUrl(s) : null;
              const generatingHere = !s && status.stage === "generating" && i === status.scenesDone;
              return (
                <div key={i} className="aspect-[9/16] rounded-lg overflow-hidden flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  {url ? (
                    <video src={url} muted loop autoPlay playsInline className="w-full h-full object-cover" />
                  ) : generatingHere ? (
                    <Loader2 size={16} className="text-cyan-400 animate-spin" />
                  ) : (
                    <span className="text-3xs text-white/25">{i + 1}</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Preview + download (ready) */}
        {status.isReady && playUrl && (
          <section className="rounded-2xl overflow-hidden"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <video src={playUrl} controls playsInline className="w-full aspect-[9/16] bg-black max-h-[70vh] object-contain mx-auto" />
            <div className="px-4 py-3 border-t border-white/5">
              <a href={playUrl} download>
                <Button variant="gradient-cyan" size="sm" className="gap-1.5">
                  <Download size={13} /> Download MP4
                </Button>
              </a>
            </div>
          </section>
        )}

        {/* Failure state + retry */}
        {status.isFailed && (
          <section className="rounded-2xl p-5 space-y-3"
            style={{ background: "rgba(244,63,94,0.05)", border: "1px solid rgba(244,63,94,0.2)" }}>
            <div className="flex items-start gap-2">
              <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white">Render failed</p>
                {status.failureReason && <p className="text-2xs text-rose-200/80 mt-1">{status.failureReason}</p>}
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
