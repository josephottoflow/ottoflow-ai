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
  Share2,
  Copy,
  Plus,
  Lock,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSupabase } from "@/components/SupabaseProvider";
import { deriveVideoJobStatus, type VideoJobStage } from "@/lib/video/status";
import type { DbRenderJob, DbSceneGeneration } from "@/lib/types";
import { toAppMediaUrl } from "@/lib/media-url";

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

/** Customer-facing stages, mapped 1:1 to the real backend stages (no invented
 * progress). "Creating your video" is the compose stage — captions, brand bar
 * and final assembly all happen inside it; they are not separate backend events. */
const STEPS = [
  { label: "Preparing your story", sub: "Designing your commercial" },
  { label: "Generating scenes", sub: "Filming each scene with AI" },
  { label: "Creating your video", sub: "Editing, captions & branding" },
  { label: "Ready", sub: "Preview & download" },
] as const;

/** Customer-facing badge label for a stage (no developer terms). */
function friendlyLabel(stage: VideoJobStage): string {
  return { queued: "Preparing", generating: "Generating", composing: "Creating video", ready: "Ready", failed: "Needs attention" }[stage];
}
/** Customer-facing one-line detail (softens internal/worker language).
 * Sprint 15 — the "generating" stage reads differently for the Royalty-Free
 * Library (footage sourcing) vs AI Generated (scene filming). */
function friendlyDetail(status: { stage: VideoJobStage; detail: string; isStuck: boolean; scenesDone: number; scenesTotal: number }, isPexels = false): string {
  if (status.isStuck) return "This is taking longer than usual to start. Try refreshing in a moment.";
  switch (status.stage) {
    case "queued": return "Getting your story ready…";
    case "generating": return isPexels
      ? `Finding licensed footage — clip ${Math.min(status.scenesDone + 1, status.scenesTotal)} of ${status.scenesTotal}…`
      : `Filming scene ${Math.min(status.scenesDone + 1, status.scenesTotal)} of ${status.scenesTotal}…`;
    case "composing": return "Editing your video — adding captions & brand…";
    case "ready": return "Your video is ready to preview and download.";
    case "failed": return status.detail;
  }
}

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

function elapsedSeconds(job: DbRenderJob): number {
  const start = Date.parse(job.started_at ?? job.created_at ?? "");
  if (!start) return 0;
  const end = job.completed_at ? Date.parse(job.completed_at) : Date.now();
  return Math.max(0, Math.round((end - start) / 1000));
}
function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}
function elapsed(job: DbRenderJob): string {
  return fmtDuration(elapsedSeconds(job));
}
/** "Produced in X" is only honest when the wall-clock reflects production, not
 * long queue waits. Beyond a plausible ceiling the span is dominated by idle
 * queue time (worker downtime), so we omit the claim rather than show a
 * misleading multi-hour "production" time. */
const MAX_PLAUSIBLE_PRODUCTION_SEC = 30 * 60;
function plausibleProductionTime(job: DbRenderJob): string | null {
  const sec = elapsedSeconds(job);
  return sec > 0 && sec <= MAX_PLAUSIBLE_PRODUCTION_SEC ? fmtDuration(sec) : null;
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
  const playUrl = toAppMediaUrl(job.merged_video_url ?? null);
  const showRefresh = stopped && !terminal;
  // Sprint 15 — creative source (from render_jobs.scene_provider) drives the badge
  // + the "generating" stage wording (Royalty-Free footage vs AI scenes).
  const isPexels = (job as { scene_provider?: string | null }).scene_provider === "pexels";

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
            <h1 className="text-xl font-bold">{job.name || "Your video"}</h1>
            <Badge variant={STAGE_BADGE[status.stage]} className="text-3xs">{friendlyLabel(status.stage)}</Badge>
            <span className="text-3xs px-1.5 py-0.5 rounded-md" style={isPexels ? { background: "rgba(34,211,238,0.10)", color: "#67e8f9" } : { background: "rgba(168,139,250,0.12)", color: "#c4b5fd" }}>
              {isPexels ? "🎥 Royalty-Free Library" : "⭐ AI Generated"}
            </span>
            {showRefresh && (
              <Button variant="outline" size="sm" className="gap-1.5 ml-auto" onClick={onManualRefresh} disabled={refreshing}>
                {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Refresh
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 text-2xs text-white/55 flex-wrap">
            {brand && <Link href={`/brands/${brand.id}`} className="hover:text-cyan-400">{brand.name}</Link>}
            {(() => {
              // While rendering, the live elapsed is meaningful. Once terminal, only
              // show it when plausible (else it's dominated by queue-wait time).
              const t = terminal ? plausibleProductionTime(job) : elapsed(job);
              return t ? <><span>·</span><span className="flex items-center gap-1"><Clock size={10} />{t}</span></> : null;
            })()}
            {showRefresh && <><span>·</span><span className="text-amber-300/80">live updates paused</span></>}
          </div>
        </header>

        {/* Strategy + cost summary (Task 5) */}
        <StrategyCostSummary job={job} scenesTotal={status.scenesTotal} />

        {/* Stuck banner */}
        {status.isStuck && (
          <div className="rounded-xl px-4 py-3 text-2xs flex items-start gap-2"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}>
            <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
            <span className="text-amber-200/90">{friendlyDetail(status, isPexels)}</span>
          </div>
        )}

        {/* Progress */}
        <section className="space-y-2">
          <div className="flex items-center justify-between text-2xs text-white/60">
            <span>{friendlyDetail(status, isPexels)}</span>
            <span>{status.progressPct}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div className="h-full rounded-full transition-all"
              style={{ width: `${status.progressPct}%`, background: status.isFailed ? "rgb(244,63,94)" : "linear-gradient(90deg,#22d3ee,#818cf8)" }} />
          </div>
        </section>

        {/* Stage stepper — customer-facing stages mapped to real backend stages */}
        <section className="flex items-start gap-2">
          {STEPS.map((s, i) => {
            const state = status.isFailed && i === step ? "error" : (i < step || (status.isReady && i === step)) ? "done" : i === step ? "active" : "pending";
            return (
              <div key={s.label} className="flex-1 flex flex-col items-center gap-1 text-center">
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
                <span className={`text-3xs ${i <= step ? "text-white/70" : "text-white/30"}`}>{s.label}</span>
                {i === step && !status.isFailed && <span className="text-3xs text-white/35 leading-tight">{s.sub}</span>}
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

        {/* Success experience (ready) — celebration + preview + actions + suggestions */}
        {status.isReady && playUrl && (
          <SuccessExperience job={job} playUrl={playUrl} producedIn={plausibleProductionTime(job)} />
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

            {/* Sprint 14 P5 — fallback strategy, in priority order. Only "retry AI"
                exists today; switching to stock isn't a wired backend choice, so it's
                honestly Coming soon. Nothing simulated. */}
            <div className="pt-3 mt-1 border-t border-white/5">
              <p className="text-2xs text-white/70 mb-2">Rendering is temporarily unavailable. You can:</p>
              <ul className="space-y-1.5">
                <li className="flex items-center gap-2 text-2xs text-white/70">
                  <RefreshCw size={11} className="text-cyan-300" /> <span className="text-white/85">Retry AI rendering</span> — re-run the same brief (available now).
                </li>
                {[
                  ["Switch to Premium Stock", "Licensed footage instead of AI scenes"],
                  ["Switch to Free Stock", "Royalty-free footage instead of AI scenes"],
                ].map(([label, desc]) => (
                  <li key={label} className="flex items-center gap-2 text-2xs text-white/40">
                    <Lock size={10} /> <span className="text-white/55">{label}</span> — {desc}.
                    <span className="ml-1 text-3xs">Coming soon</span>
                  </li>
                ))}
              </ul>
              <p className="text-3xs text-white/45 mt-2">If this was a credit or provider issue, your render will resume when AI rendering is available again — no need to rebuild the brief.</p>
            </div>
          </section>
        )}

        {/* Queued empty hint (not a blank screen) */}
        {status.stage === "queued" && !status.isStuck && (
          <section className="rounded-2xl px-6 py-8 text-center"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)" }}>
            <Film size={26} className="text-white/30 mx-auto mb-3" />
            <p className="text-sm text-white/60">Getting your story ready — your video will begin shortly.</p>
          </section>
        )}
      </div>
    </div>
  );
}

/** Success experience (Sprint 9 — P4/P5/P8). Celebration + preview + real actions
 * (download, create another version) and honest "Coming soon" affordances for
 * publishing destinations and AI re-direction. Presentation only — no new API. */
function SuccessExperience({
  job, playUrl, producedIn,
}: { job: DbRenderJob; playUrl: string; producedIn: string | null }) {
  const [showPublish, setShowPublish] = useState(false);

  // "Create another version" → the canonical Studio entry (/video/start resolves
  // the latest eligible content item and opens the AI Creative Studio in one click).
  // Navigation only.
  const againHref = "/video/start";

  // Publishing destinations are presented but not yet wired for video (content-only
  // pipeline today) — shown as the upcoming experience, clearly "Coming soon".
  const destinations = ["LinkedIn", "Instagram", "TikTok", "YouTube", "Facebook", "X"];

  // AI re-direction suggestions (P5) — no backend support yet → "Coming soon".
  const suggestions = [
    { label: "More emotional", hint: "Lean into story & feeling" },
    { label: "Faster pacing", hint: "Tighter cuts, higher energy" },
    { label: "Executive version", hint: "Polished, authority tone" },
    { label: "Product-first", hint: "Lead with the product" },
  ];

  return (
    <>
      {/* Celebration banner */}
      <div className="rounded-xl px-4 py-3 flex items-center gap-2.5"
        style={{ background: "rgba(16,185,129,0.10)", border: "1px solid rgba(52,211,153,0.25)" }}>
        <span className="text-lg" aria-hidden>🎉</span>
        <div>
          <p className="text-sm font-semibold" style={{ color: "#34d399" }}>Your video is ready</p>
          <p className="text-3xs text-white/55 mt-0.5">{producedIn ? `Produced in ${producedIn} · ` : ""}Ready to preview, download &amp; share</p>
        </div>
      </div>

      {/* Preview + action bar */}
      <section className="rounded-2xl overflow-hidden"
        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <PreviewPlayer url={playUrl} />
        <div className="px-4 py-3 border-t border-white/5 flex items-center gap-2 flex-wrap">
          <a href={playUrl} download>
            <Button variant="gradient-cyan" size="sm" className="gap-1.5">
              <Download size={13} /> Download
            </Button>
          </a>
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => setShowPublish((v) => !v)}>
            <Share2 size={13} /> Publish
          </Button>
          <Link href={againHref}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Plus size={13} /> Create another version
            </Button>
          </Link>
          <Button variant="outline" size="sm" className="gap-1.5 opacity-60" disabled title="Duplicate this video — coming soon">
            <Copy size={13} /> Duplicate <Lock size={10} />
          </Button>
        </div>

        {/* Publish destinations (P8) — premium preview, honestly Coming soon for video */}
        {showPublish && (
          <div className="px-4 py-3 border-t border-white/5">
            <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-2">Publish to</p>
            <div className="flex flex-wrap gap-1.5">
              {destinations.map((d) => (
                <span key={d} className="text-2xs px-2.5 py-1 rounded-lg flex items-center gap-1.5"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  {d} <Lock size={9} className="text-white/35" />
                </span>
              ))}
            </div>
            <p className="text-3xs text-white/40 mt-2">One-click publishing to your connected accounts is coming soon. For now, download and post natively.</p>
          </div>
        )}
      </section>

      {/* AI re-direction suggestions (P5) — Coming soon (no backend support yet) */}
      <section className="rounded-2xl p-4 space-y-3"
        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-1.5">
          <Sparkles size={12} className="text-cyan-400" />
          <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold">Make a variation</p>
          <span className="text-3xs text-white/30 flex items-center gap-0.5 ml-1"><Lock size={9} /> Coming soon</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {suggestions.map((s) => (
            <div key={s.label} className="rounded-lg p-2.5 opacity-70"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <Wand2 size={11} className="text-cyan-300/70" />
                <p className="text-2xs font-semibold text-white/80">{s.label}</p>
              </div>
              <p className="text-3xs text-white/45 leading-snug">{s.hint}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

/** Strategy summary (concept + 4 beats) + cost summary, read off render_jobs.video_strategy. */
function StrategyCostSummary({ job, scenesTotal }: { job: DbRenderJob; scenesTotal: number }) {
  const vs = (job as {
    video_strategy?: {
      video_concept?: string;
      scenes?: { role?: string; caption?: string; durationSec?: number }[];
    };
  }).video_strategy;
  if (!vs) return null;
  const scenes = vs.scenes ?? [];
  const totalSec = scenes.reduce((a, s) => a + (s.durationSec ?? 5), 0) || scenesTotal * 5;
  const estUsd = totalSec * 0.1; // seedance standard rate (matches video/cost.ts)
  return (
    <section className="rounded-2xl p-4 space-y-3"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold">Your story</p>
        <span className="text-2xs text-white/55">
          {scenes.length || scenesTotal} scenes · {totalSec}s · ~${estUsd.toFixed(2)}
        </span>
      </div>
      {vs.video_concept && <p className="text-xs text-white/75 leading-relaxed">{vs.video_concept}</p>}
      {scenes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {scenes.map((s, i) => (
            <Badge key={i} variant="purple" className="text-3xs">
              {s.role ?? `Scene ${i + 1}`}{s.caption ? ` — ${s.caption}` : ""}
            </Badge>
          ))}
        </div>
      )}
    </section>
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
