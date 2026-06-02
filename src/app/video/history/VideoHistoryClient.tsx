"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Video,
  Download,
  RefreshCw,
  ChevronRight,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Film,
  ArrowLeft,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { captureFallback } from "@/lib/observability";
import type { DbRenderJob } from "@/lib/types";

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
  if (job.merge_status === "done" && job.merged_video_url) {
    return (
      <Badge variant="success" className="text-[10px]">
        Ready
      </Badge>
    );
  }
  if (job.merge_status === "merging" || job.merge_status === "pending") {
    return (
      <Badge variant="info" className="text-[10px]">
        Merging…
      </Badge>
    );
  }
  if (job.status === "rendering") {
    return (
      <Badge variant="info" className="text-[10px]">
        Rendering
      </Badge>
    );
  }
  if (job.status === "failed" || job.merge_status === "failed") {
    return (
      <Badge variant="destructive" className="text-[10px]">
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="warning" className="text-[10px]">
      Queued
    </Badge>
  );
}

export function VideoHistoryClient({ jobs, brandLookup }: Props) {
  const [filterBrandId, setFilterBrandId] = useState<string | null>(null);
  const allBrands = Object.values(brandLookup);

  const filtered = filterBrandId
    ? jobs.filter((j) => j.brand_id === filterBrandId)
    : jobs;

  return (
    <div className="min-h-screen text-white">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/video/generate"
            className="text-white/50 hover:text-white transition-colors flex items-center gap-1.5"
          >
            <ArrowLeft size={14} />
            <span className="text-xs">Generate</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/video/generate">
              <Button variant="gradient-cyan" size="sm" className="gap-1.5">
                <Sparkles size={13} />
                New video
              </Button>
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Film size={16} className="text-cyan-400" />
          <h1 className="text-xl font-bold">Video History</h1>
          <span className="text-[11px] text-white/40">
            {filtered.length} generation{filtered.length === 1 ? "" : "s"}
          </span>
        </div>

        {allBrands.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setFilterBrandId(null)}
              className={`text-[11px] rounded-full px-3 py-1 transition-colors ${
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
                className={`text-[11px] rounded-full px-3 py-1 transition-colors ${
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
          <div
            className="rounded-2xl p-10 text-center"
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px dashed rgba(255,255,255,0.08)",
            }}
          >
            <Video size={28} className="text-white/30 mx-auto mb-3" />
            <p className="text-sm text-white/60 mb-1">No videos yet</p>
            <p className="text-[12px] text-white/40 mb-5">
              Generate your first video from a brand topic.
            </p>
            <Link href="/video/generate">
              <Button variant="gradient-cyan" size="sm" className="gap-1.5">
                <Sparkles size={13} />
                Generate video
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((job) => (
              <HistoryRow
                key={job.id}
                job={job}
                brandName={
                  job.brand_id ? brandLookup[job.brand_id]?.name ?? null : null
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryRow({
  job,
  brandName,
}: {
  job: DbRenderJob;
  brandName: string | null;
}) {
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  const script = job.script_json as { hook?: string } | null;
  const seo = job.seo_json as { title?: string } | null;
  const overlayCount =
    (job.overlay_json as { keywords?: unknown[] } | null)?.keywords?.length ??
    0;
  const downloadUrl = job.merged_video_url ?? job.output_url ?? null;
  const ready = !!job.merged_video_url;

  const headline =
    seo?.title?.trim() ||
    script?.hook?.trim() ||
    job.name?.trim() ||
    "Untitled video";

  const handleRegenerate = async () => {
    setRegenerating(true);
    setRegenError(null);
    try {
      // Phase 7 regenerate path: kick a new generation reusing the brand
      // + topic + style. If no topic was attached, fall back to prompt.
      const body =
        job.brand_id && job.topic_id
          ? {
              brandId: job.brand_id,
              topicId: job.topic_id,
              style: job.style ?? "educational",
            }
          : job.prompt
            ? { prompt: job.prompt, style: job.style ?? "cinematic" }
            : null;

      if (!body) {
        throw new Error(
          "This generation has no brand+topic or prompt to regenerate from.",
        );
      }

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok && res.status !== 200) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `Server returned ${res.status}`);
      }
      // The response is SSE — we don't need to consume it here. Redirect
      // to /video/generate so the user sees the live pipeline.
      window.location.href = "/video/generate";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRegenError(msg);
      captureFallback("video.history.regenerate_failed", err, {
        jobId: job.id,
      });
      setRegenerating(false);
    }
  };

  return (
    <div
      className="rounded-xl p-4 transition-colors hover:bg-white/[0.025]"
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-start gap-4">
        {/* Thumbnail (placeholder when no merged URL — Phase 7+ ffmpeg
            thumbnail extraction would replace this) */}
        <div
          className="w-24 h-24 sm:w-32 sm:h-32 rounded-lg shrink-0 flex items-center justify-center overflow-hidden"
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          {ready ? (
            // Use poster-style first-frame display via <video> with preload="metadata"
            <video
              src={downloadUrl ?? undefined}
              className="w-full h-full object-cover"
              preload="metadata"
              muted
              playsInline
            />
          ) : (
            <Film size={20} className="text-white/30" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="text-[13px] font-semibold text-white truncate">
              {headline}
            </p>
            {statusBadge(job)}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-white/50 mb-2 flex-wrap">
            {brandName && (
              <Link
                href={`/brands/${job.brand_id}`}
                className="hover:text-cyan-400 transition-colors"
              >
                {brandName}
              </Link>
            )}
            {job.style && (
              <>
                <span>·</span>
                <span>{job.style}</span>
              </>
            )}
            {job.template && job.template !== job.style && (
              <>
                <span>·</span>
                <span>{job.template}</span>
              </>
            )}
            {overlayCount > 0 && (
              <>
                <span>·</span>
                <span>{overlayCount} overlays</span>
              </>
            )}
            <span>·</span>
            <span>{timeAgo(job.created_at ?? job.started_at)}</span>
          </div>
          {script?.hook && (
            <p className="text-[12px] text-white/55 line-clamp-2 italic mb-2">
              &ldquo;{script.hook}&rdquo;
            </p>
          )}
          <Link
            href={`/video/${job.id}`}
            className="text-[10px] text-cyan-400 hover:underline mb-2 inline-block"
          >
            View generation details →
          </Link>
          {job.merge_error && (
            <p className="text-[11px] text-rose-300/80 flex items-center gap-1.5 mb-2">
              <AlertCircle size={11} />
              {job.merge_error}
            </p>
          )}
          {regenError && (
            <p className="text-[11px] text-rose-300/80 mb-2">{regenError}</p>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {downloadUrl && ready && (
              <a href={downloadUrl} download>
                <Button variant="gradient-cyan" size="sm" className="gap-1.5 h-7 text-[11px]">
                  <Download size={11} />
                  Download
                </Button>
              </a>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-7 text-[11px]"
              onClick={handleRegenerate}
              disabled={regenerating}
            >
              {regenerating ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <RefreshCw size={11} />
              )}
              Regenerate
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
