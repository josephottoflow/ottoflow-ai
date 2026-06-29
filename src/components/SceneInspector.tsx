"use client";

/**
 * SceneInspector — "Replace Visual" panel for one storyboard scene (Sprint 39.1).
 *
 * Loads ranked stock candidates from the Sprint-39 endpoint
 *   POST /api/video/jobs/[jobId]/scene/[sceneId]/candidates
 * which reuses the SAME Pexels engine the renderer uses (no second search
 * engine), so what the customer compares here IS the pool the render picks from.
 *
 * Search-only + read-only by design: it inspects/compares/refreshes candidates
 * and surfaces the honest "why" for each. The actual swap is delegated to the
 * parent via `onReplace` (when provided) — this component never mutates a job,
 * never renders, never enqueues.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Check, X, Film, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SceneCandidate {
  id: number;
  provider: string;
  url: string;
  thumbnailUrl: string | null;
  durationSec: number;
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
  query: string;
  score: number;
  reason: string;
}

interface Props {
  jobId: string;
  sceneId: number;
  aspect?: "9:16" | "16:9" | "1:1";
  /** The clip currently used by this scene, shown first for comparison. */
  currentClipUrl?: string | null;
  /** Provided → shows "Use this visual"; absent → inspect-only. */
  onReplace?: (candidate: SceneCandidate) => void;
  replacing?: boolean;
  onClose?: () => void;
}

export function SceneInspector({
  jobId,
  sceneId,
  aspect,
  currentClipUrl,
  onReplace,
  replacing = false,
  onClose,
}: Props) {
  const [candidates, setCandidates] = useState<SceneCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/video/jobs/${jobId}/scene/${sceneId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(aspect ? { aspect } : {}),
      });
      const json = (await res.json().catch(() => ({}))) as {
        candidates?: SceneCandidate[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? `Search failed (${res.status})`);
      setCandidates(json.candidates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, [jobId, sceneId, aspect]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div
      className="rounded-xl border border-white/[0.08] p-3 space-y-3"
      style={{ background: "rgba(255,255,255,0.02)" }}
    >
      <div className="flex items-center gap-2">
        <Film size={13} className="text-cyan-400" />
        <span className="text-2xs font-semibold text-white/80">
          Replace visual · Scene {sceneId}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-2xs" onClick={() => load()} disabled={loading}>
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Find more options
          </Button>
          {onClose && (
            <button type="button" aria-label="Close" onClick={onClose}
              className="w-6 h-6 rounded flex items-center justify-center text-white/40 hover:text-white">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-2xs text-amber-400 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {loading && candidates.length === 0 ? (
        <div className="flex items-center gap-2 text-2xs text-white/45 py-6 justify-center">
          <Loader2 size={14} className="animate-spin" /> Searching stock library…
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {currentClipUrl && (
            <Card
              label="Current"
              videoUrl={currentClipUrl}
              badges={["in use"]}
              highlight
            />
          )}
          {candidates.map((c) => (
            <Card
              key={c.id}
              videoUrl={c.url}
              poster={c.thumbnailUrl}
              badges={[c.provider, `${c.durationSec}s`, c.orientation, `${c.height}p`]}
              reason={c.reason}
              action={
                onReplace
                  ? { label: "Use this visual", onClick: () => onReplace(c), busy: replacing }
                  : undefined
              }
            />
          ))}
          {!loading && candidates.length === 0 && !error && (
            <p className="col-span-full text-2xs text-white/40 italic py-4 text-center">
              No alternative clips found for this scene.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Card({
  videoUrl,
  poster,
  label,
  badges,
  reason,
  highlight,
  action,
}: {
  videoUrl: string;
  poster?: string | null;
  label?: string;
  badges: string[];
  reason?: string;
  highlight?: boolean;
  action?: { label: string; onClick: () => void; busy?: boolean };
}) {
  return (
    <div
      className="rounded-lg overflow-hidden border"
      style={{
        borderColor: highlight ? "rgba(34,211,238,0.4)" : "rgba(255,255,255,0.07)",
        background: "rgba(0,0,0,0.25)",
      }}
    >
      <div className="relative aspect-[9/16] bg-black/40 max-h-44">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          src={videoUrl}
          poster={poster ?? undefined}
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          className="w-full h-full object-cover"
        />
        {label && (
          <span className="absolute top-1 left-1 text-3xs font-semibold px-1.5 py-0.5 rounded bg-cyan-500/80 text-white">
            {label}
          </span>
        )}
      </div>
      <div className="p-2 space-y-1">
        <div className="flex flex-wrap gap-1">
          {badges.map((b, i) => (
            <span key={i} className="text-3xs px-1.5 py-0.5 rounded bg-white/[0.06] text-white/55 capitalize">
              {b}
            </span>
          ))}
        </div>
        {reason && <p className="text-3xs text-white/45 leading-snug">{reason}</p>}
        {action && (
          <Button
            variant="gradient-cyan"
            size="sm"
            className="w-full h-7 gap-1.5 text-2xs"
            onClick={action.onClick}
            disabled={action.busy}
          >
            {action.busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
