"use client";

/**
 * CostApprovalModal — Video V1 cost-approval gate (Track B Task 1).
 *
 * Shown after a `dryRun:true` call to POST /api/video/generate returns a
 * strategy + cost estimate (zero spend). The user reviews the 4-beat strategy
 * and the dollar figure, then Approve → the caller re-POSTs with
 * `approve:true` to authorize the spend and enqueue the render.
 *
 * Pure presentational + a backdrop; no data fetching here (the button owns the
 * fetch lifecycle). Matches the app's "glass" styling.
 */
import { Loader2, Clapperboard, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RenderCostEstimate } from "@/lib/video/cost";

export interface StrategySummary {
  video_concept?: string;
  visual_tension?: string;
  visual_metaphor?: string;
  scenes?: {
    sceneId: number;
    role?: string;
    durationSec?: number;
    /** Present in the V1 dryRun today (scene description / goal). */
    prompt?: string;
    caption?: string;
    // ── Sprint 2 (Story Agent) — optional now; the storyboard renders them
    //    automatically once the Story Agent populates these fields. ──
    goal?: string;
    subject?: string;
    environment?: string;
    camera?: string;
  }[];
}

interface CostApprovalModalProps {
  open: boolean;
  estimate: RenderCostEstimate | null;
  strategy: StrategySummary | null;
  approving: boolean;
  error: string | null;
  onApprove: () => void;
  onCancel: () => void;
}

export function CostApprovalModal({
  open,
  estimate,
  strategy,
  approving,
  error,
  onApprove,
  onCancel,
}: CostApprovalModalProps) {
  if (!open) return null;

  const cost = estimate ? `$${estimate.estimatedCostUsd.toFixed(2)}` : "—";
  const scenes = estimate?.sceneCount ?? strategy?.scenes?.length ?? 0;
  const seconds = estimate?.totalBillableSeconds ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={approving ? undefined : onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6"
        style={{ background: "rgba(18,20,28,0.96)", border: "1px solid rgba(255,255,255,0.08)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clapperboard className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white">Approve video render</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={approving}
            className="text-white/40 hover:text-white disabled:opacity-40"
            aria-label="Cancel"
          >
            <X size={16} />
          </button>
        </div>

        {/* Cost line */}
        <div
          className="rounded-xl p-4 mb-4 flex items-center justify-between"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div>
            <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-0.5">
              Estimated cost
            </p>
            <p className="text-2xl font-bold text-white">{cost}</p>
          </div>
          <div className="text-right text-2xs text-white/55 space-y-0.5">
            <p><span className="text-white/40">Provider</span> seedance</p>
            <p><span className="text-white/40">Scenes</span> {scenes}</p>
            {seconds != null && <p><span className="text-white/40">Duration</span> {seconds}s</p>}
          </div>
        </div>

        {/* Strategy summary */}
        {strategy?.video_concept && (
          <p className="text-xs text-white/75 leading-relaxed mb-3">{strategy.video_concept}</p>
        )}

        {/* Storyboard — per-scene review before any spend (Sprint 1A). Goal,
            description, caption, duration + per-scene cost (matched by sceneId).
            Subject/Environment/Camera render automatically once the Story Agent
            (Sprint 2) populates them. */}
        {strategy?.scenes && strategy.scenes.length > 0 && (
          <div className="mb-4 space-y-2 max-h-72 overflow-y-auto pr-1">
            <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold">
              Storyboard · {strategy.scenes.length} scenes
            </p>
            {strategy.scenes.map((s, i) => {
              const line = estimate?.perScene.find((p) => p.sceneId === s.sceneId);
              const sceneCost = line ? `$${line.estimatedCostUsd.toFixed(2)}` : null;
              const goal = s.goal ?? s.role ?? `Scene ${s.sceneId}`;
              const desc = s.subject || s.environment
                ? [s.subject, s.environment].filter(Boolean).join(" · ")
                : s.prompt;
              return (
                <div
                  key={s.sceneId}
                  className="rounded-lg p-2.5"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-2xs font-semibold text-white/80">
                      {i + 1}. {goal}
                    </span>
                    <span className="text-3xs text-white/45 whitespace-nowrap">
                      {s.durationSec ? `${s.durationSec}s` : ""}{sceneCost ? ` · ${sceneCost}` : ""}
                    </span>
                  </div>
                  {desc && (
                    <p className="text-3xs text-white/55 leading-snug line-clamp-2">{desc}</p>
                  )}
                  {s.camera && (
                    <p className="text-3xs text-white/40 mt-0.5">Camera: {s.camera}</p>
                  )}
                  {s.caption && (
                    <p className="text-3xs text-cyan-300/80 italic mt-1">&ldquo;{s.caption}&rdquo;</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="text-3xs text-white/40 mb-4">
          Approving authorizes this spend and queues the render. You can track progress on the next screen.
        </p>

        {error && <p className="text-2xs text-red-400 mb-3">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={approving}>
            Cancel
          </Button>
          <Button type="button" variant="gradient-cyan" size="sm" className="gap-1.5" onClick={onApprove} disabled={approving}>
            {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
            {approving ? "Queuing…" : `Approve & render${estimate ? ` (${cost})` : ""}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
