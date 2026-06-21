"use client";

/**
 * AiFirstVideoButton — Ottoflow Video V1 trigger (Track B Tasks 1 + 2).
 *
 * Drops next to the CreativePanel on a content item. Turns the item's existing
 * creative brief (visual_tension/visual_metaphor) into a brand-aligned video.
 *
 * Flow (cost-approval gate):
 *   click → POST /api/video/generate {dryRun:true}  → strategy + cost estimate (no spend)
 *         → CostApprovalModal                         → user reviews + Approve
 *         → POST /api/video/generate {approve:true}   → 202 {renderJobId}
 *         → router.push(/video/[jobId])
 *
 * Gating (Task 2): when `disabledReason` is set (no creative brief, or the brief
 * is missing visual_tension/visual_metaphor) the button renders disabled with
 * the exact reason beneath it — never a dead, unexplained button. The route
 * enforces the same requirement server-side, surfaced inline as a backstop.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Clapperboard, Loader2 } from "lucide-react";
import { CostApprovalModal, type StrategySummary } from "@/components/CostApprovalModal";
import type { RenderCostEstimate } from "@/lib/video/cost";

interface AiFirstVideoButtonProps {
  brandId: string;
  contentItemId: string;
  /**
   * When set, the button is disabled and this exact reason is shown beneath it.
   * e.g. "Creative brief not approved" /
   * "Video generation requires visual_tension and visual_metaphor".
   */
  disabledReason?: string | null;
}

type Phase = "idle" | "estimating" | "review" | "approving";

interface DryRunResponse {
  strategy?: StrategySummary;
  estimate?: RenderCostEstimate;
  error?: string;
}

export function AiFirstVideoButton({
  brandId,
  contentItemId,
  disabledReason,
}: AiFirstVideoButtonProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [estimate, setEstimate] = useState<RenderCostEstimate | null>(null);
  const [strategy, setStrategy] = useState<StrategySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Synchronous in-flight guard: blocks duplicate dryRun/approve from rapid
  // double-clicks BEFORE React re-renders + disables the button (state lags a click).
  const inFlight = useRef(false);

  const gated = !!disabledReason;
  const busy = phase === "estimating" || phase === "approving";

  async function onEstimate() {
    if (gated || inFlight.current) return;
    inFlight.current = true;
    setPhase("estimating");
    setError(null);
    try {
      const res = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, contentItemId, platform: "linkedin", dryRun: true }),
      });
      const json = (await res.json().catch(() => ({}))) as DryRunResponse;
      if (!res.ok || !json.estimate) {
        throw new Error(json.error ?? `Could not estimate (${res.status})`);
      }
      setEstimate(json.estimate);
      setStrategy(json.strategy ?? null);
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    } finally {
      inFlight.current = false;
    }
  }

  async function onApprove() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase("approving");
    setError(null);
    try {
      const res = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Re-send the dryRun strategy so the render matches the previewed
        // cost/strategy exactly (route reuses it — no second generation, no drift).
        body: JSON.stringify({ brandId, contentItemId, platform: "linkedin", approve: true, strategy: strategy ?? undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as { renderJobId?: string; error?: string };
      if (!res.ok || !json.renderJobId) {
        throw new Error(json.error ?? `Request failed (${res.status})`);
      }
      // Leave inFlight=true on success: we're navigating away; never allow a
      // second approve (= second render_job + second spend) to slip through.
      router.push(`/video/${json.renderJobId}`);
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("review"); // keep the modal open so the user sees the error + can retry
      inFlight.current = false;
    }
  }

  function onCancel() {
    if (busy) return;
    setPhase("idle");
    setError(null);
  }

  return (
    <div className="flex flex-col gap-1 items-end">
      <Button
        type="button"
        variant="secondary"
        onClick={onEstimate}
        disabled={gated || busy}
        title={disabledReason ?? undefined}
      >
        {phase === "estimating" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Clapperboard className="h-4 w-4" />
        )}
        {phase === "estimating" ? "Estimating…" : "Generate Video (LinkedIn)"}
      </Button>

      {/* Task 2: explain WHY it's disabled — never a dead button. */}
      {gated && <p className="text-3xs text-white/40 max-w-[260px] text-right">{disabledReason}</p>}
      {!gated && error && phase === "idle" && (
        <p className="text-3xs text-red-400 max-w-[260px] text-right">{error}</p>
      )}

      <CostApprovalModal
        open={phase === "review" || phase === "approving"}
        estimate={estimate}
        strategy={strategy}
        approving={phase === "approving"}
        error={error}
        onApprove={onApprove}
        onCancel={onCancel}
      />
    </div>
  );
}
