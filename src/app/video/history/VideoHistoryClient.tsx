"use client";

/**
 * VideoHistoryClient — "Video Library" gallery (Sprint 9, presentation only).
 *
 * A premium gallery of the user's past generations from render_jobs: poster
 * thumbnail (real first frame of the finished MP4), status badge, version badge
 * (derived from grouping renders by brand + topic — no schema change), timestamp,
 * and quick actions (Preview / Download / Regenerate). Read-only against the
 * existing data; no API / payload / worker / queue / pricing changes.
 *
 * Honest gaps surfaced as "Coming soon": per-video platform badge (platform is
 * not persisted on the render-job row today) and cover selection (no cover field).
 */
import Link from "next/link";
import { useState } from "react";
import {
  Video,
  Download,
  RefreshCw,
  Sparkles,
  AlertCircle,
  Loader2,
  Film,
  ArrowLeft,
  Play,
  Image as ImageIcon,
  Lock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { captureFallback } from "@/lib/observability";
import type { DbRenderJob } from "@/lib/types";
import { phaseOf } from "@/lib/render-phase";
import { toAppMediaUrl } from "@/lib/media-url";

interface Props {
  jobs: DbRenderJob[];
  brandLookup: Record<string, { id: string; name: string }>;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function statusBadge(job: DbRenderJob) {
  const p = phaseOf(job);
  if (p === "ready") return <Badge variant="success" className="text-3xs">Ready</Badge>;
  if (p === "working") return <Badge variant="info" className="text-3xs">Creating…</Badge>;
  if (p === "failed") return <Badge variant="destructive" className="text-3xs">Failed</Badge>;
  return <Badge variant="warning" className="text-3xs">Preparing</Badge>;
}

/** Group renders that share a brand + topic, ordered oldest→newest, so the Nth
 * render of the same idea is "v{N}". Derived only from existing data (no schema
 * change). Returns a map of jobId → { version, total }. */
function computeVersions(jobs: DbRenderJob[]): Record<string, { version: number; total: number }> {
  const norm = (j: DbRenderJob) => `${j.brand_id ?? "_"}::${(j.prompt ?? j.name ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80)}`;
  const groups: Record<string, DbRenderJob[]> = {};
  for (const j of jobs) (groups[norm(j)] ??= []).push(j);
  const out: Record<string, { version: number; total: number }> = {};
  for (const list of Object.values(groups)) {
    const ordered = [...list].sort(
      (a, b) => new Date(a.created_at ?? a.started_at).getTime() - new Date(b.created_at ?? b.started_at).getTime(),
    );
    ordered.forEach((j, i) => { out[j.id] = { version: i + 1, total: ordered.length }; });
  }
  return out;
}

export function VideoHistoryClient({ jobs, brandLookup }: Props) {
  const [filterBrandId, setFilterBrandId] = useState<string | null>(null);
  const allBrands = Object.values(brandLookup);
  const versions = computeVersions(jobs);

  const filtered = filterBrandId ? jobs.filter((j) => j.brand_id === filterBrandId) : jobs;
  const readyCount = filtered.filter((j) => phaseOf(j) === "ready").length;

  return (
    <div className="min-h-screen text-white">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/video/start" className="text-white/50 hover:text-white transition-colors flex items-center gap-1.5">
            <ArrowLeft size={14} />
            <span className="text-xs">Generate</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/video/start">
              <Button variant="gradient-cyan" size="sm" className="gap-1.5">
                <Sparkles size={13} />
                New video
              </Button>
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Film size={16} className="text-cyan-400" />
          <h1 className="text-xl font-bold">Video Library</h1>
          {filtered.length > 0 && (
            <span className="text-2xs text-white/40">
              {filtered.length} video{filtered.length === 1 ? "" : "s"}
              {readyCount > 0 && <span className="text-emerald-300/70"> · {readyCount} ready</span>}
            </span>
          )}
        </div>

        {allBrands.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setFilterBrandId(null)}
              className={`text-2xs rounded-full px-3 py-1 transition-colors ${
                filterBrandId === null
                  ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                  : "bg-white/[0.03] text-white/55 border border-white/[0.06] hover:border-white/15"
              }`}
            >
              All brands
            </button>
            {allBrands.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setFilterBrandId(b.id)}
                className={`text-2xs rounded-full px-3 py-1 transition-colors ${
                  filterBrandId === b.id
                    ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                    : "bg-white/[0.03] text-white/55 border border-white/[0.06] hover:border-white/15"
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyLibrary />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((job) => (
              <VideoCard
                key={job.id}
                job={job}
                brandName={job.brand_id ? brandLookup[job.brand_id]?.name ?? null : null}
                ver={versions[job.id]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Premium empty state (P3). */
function EmptyLibrary() {
  return (
    <div
      className="rounded-2xl px-6 py-16 text-center"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.10)" }}
    >
      <div
        className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center"
        style={{ background: "linear-gradient(135deg, rgba(34,211,238,0.15), rgba(129,140,248,0.15))", border: "1px solid rgba(34,211,238,0.25)" }}
      >
        <Film size={26} className="text-cyan-300" />
      </div>
      <p className="text-base font-semibold text-white mb-1.5">Your video library starts here</p>
      <p className="text-xs text-white/50 mb-6 max-w-sm mx-auto leading-relaxed">
        Turn any brand topic into a polished, platform-ready commercial. Every video you create lands here — preview, download, and refine.
      </p>
      <Link href="/video/start">
        <Button variant="gradient-cyan" size="sm" className="gap-1.5">
          <Sparkles size={13} />
          Create your first video
        </Button>
      </Link>
    </div>
  );
}

function VideoCard({
  job,
  brandName,
  ver,
}: {
  job: DbRenderJob;
  brandName: string | null;
  ver?: { version: number; total: number };
}) {
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  const script = job.script_json as { hook?: string } | null;
  const seo = job.seo_json as { title?: string } | null;
  const downloadUrl = toAppMediaUrl(job.merged_video_url ?? job.output_url ?? null);
  const phase = phaseOf(job);
  const ready = phase === "ready";
  const headline = seo?.title?.trim() || script?.hook?.trim() || job.name?.trim() || "Untitled video";

  const handleRegenerate = async () => {
    setRegenerating(true);
    setRegenError(null);
    try {
      const body =
        job.brand_id && job.topic_id
          ? { brandId: job.brand_id, topicId: job.topic_id, style: job.style ?? "educational" }
          : job.prompt
            ? { prompt: job.prompt, style: job.style ?? "cinematic" }
            : null;
      if (!body) throw new Error("This generation has no brand+topic or prompt to regenerate from.");
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok && res.status !== 200) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `Server returned ${res.status}`);
      }
      window.location.href = "/video/start";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRegenError(msg);
      captureFallback("video.history.regenerate_failed", err, { jobId: job.id });
      setRegenerating(false);
    }
  };

  return (
    <div
      className="group rounded-2xl overflow-hidden transition-colors hover:border-white/15 flex flex-col"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
    >
      {/* Cover / thumbnail (P7) */}
      <Link href={`/video/${job.id}`} className="relative block aspect-video overflow-hidden"
        style={{ background: "linear-gradient(135deg, rgba(34,211,238,0.06), rgba(129,140,248,0.06))" }}>
        {ready && downloadUrl ? (
          <video src={downloadUrl} className="w-full h-full object-cover" preload="metadata" muted playsInline />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {phase === "failed" ? <AlertCircle size={22} className="text-rose-300/60" /> : <Film size={22} className="text-white/25" />}
          </div>
        )}
        {/* hover play affordance for ready videos */}
        {ready && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: "rgba(0,0,0,0.25)" }}>
            <span className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
              <Play size={16} className="text-white ml-0.5" />
            </span>
          </div>
        )}
        {/* status (top-left) + version (top-right) */}
        <div className="absolute top-2 left-2">{statusBadge(job)}</div>
        {ver && ver.total > 1 && (
          <div className="absolute top-2 right-2">
            <span className="text-3xs px-1.5 py-0.5 rounded-md bg-black/55 text-white/85 border border-white/10" title={`Version ${ver.version} of ${ver.total} for this topic`}>
              v{ver.version}
            </span>
          </div>
        )}
        {/* cover selection — honest Coming soon (P7) */}
        {ready && (
          <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="text-3xs px-1.5 py-0.5 rounded-md bg-black/55 text-white/55 border border-white/10 flex items-center gap-1" title="Choose a cover frame — coming soon">
              <ImageIcon size={9} /> Cover <Lock size={8} />
            </span>
          </div>
        )}
      </Link>

      {/* Body */}
      <div className="p-3.5 flex flex-col flex-1">
        <Link href={`/video/${job.id}`} className="block">
          <p className="text-sm font-semibold text-white line-clamp-2 leading-snug hover:text-cyan-200 transition-colors">{headline}</p>
        </Link>
        {/* Sprint 15 — creative source badge (from render_jobs.scene_provider) */}
        {(() => {
          const isPexels = (job as { scene_provider?: string | null }).scene_provider === "pexels";
          return (
            <span className="inline-flex items-center gap-1 w-fit mt-1.5 text-3xs px-1.5 py-0.5 rounded-md"
              style={isPexels ? { background: "rgba(34,211,238,0.10)", color: "#67e8f9" } : { background: "rgba(168,139,250,0.12)", color: "#c4b5fd" }}>
              {isPexels ? "🎥 Royalty-Free Library" : "⭐ AI Generated"}
            </span>
          );
        })()}
        <div className="flex items-center gap-1.5 text-2xs text-white/45 mt-1.5 flex-wrap">
          {brandName && (
            <Link href={`/brands/${job.brand_id}`} className="hover:text-cyan-400 transition-colors">{brandName}</Link>
          )}
          {job.style && (<><span>·</span><span className="capitalize">{job.style}</span></>)}
          <span>·</span>
          <span>{timeAgo(job.created_at ?? job.started_at)}</span>
        </div>

        {job.merge_error && phase === "failed" && (
          <p className="text-2xs text-rose-300/80 flex items-center gap-1.5 mt-2">
            <AlertCircle size={11} /> {job.merge_error}
          </p>
        )}
        {regenError && <p className="text-2xs text-rose-300/80 mt-2">{regenError}</p>}

        {/* Quick actions (P2) */}
        <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-white/5">
          {ready && downloadUrl ? (
            <a href={downloadUrl} download className="flex-1">
              <Button variant="gradient-cyan" size="sm" className="gap-1.5 h-7 text-2xs w-full">
                <Download size={11} /> Download
              </Button>
            </a>
          ) : (
            <Link href={`/video/${job.id}`} className="flex-1">
              <Button variant="secondary" size="sm" className="gap-1.5 h-7 text-2xs w-full">
                {phase === "working" ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                {phase === "failed" ? "View" : phase === "working" ? "Watch progress" : "Open"}
              </Button>
            </Link>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-7 text-2xs shrink-0"
            onClick={handleRegenerate}
            disabled={regenerating}
            title="Generate a fresh version from the same brand & topic"
          >
            {regenerating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            New version
          </Button>
        </div>
      </div>
    </div>
  );
}
