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
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Clapperboard } from "lucide-react";
import { VideoConfigModal } from "@/components/VideoConfigModal";

interface AiFirstVideoButtonProps {
  brandId: string;
  contentItemId: string;
  /** Shown in the configurator's "Content" row. */
  contentTitle?: string;
  /**
   * When set, the button is disabled and this exact reason is shown beneath it.
   * e.g. "Creative brief not approved" /
   * "Video generation requires visual_tension and visual_metaphor".
   */
  disabledReason?: string | null;
}

export function AiFirstVideoButton({
  brandId,
  contentItemId,
  contentTitle,
  disabledReason,
}: AiFirstVideoButtonProps) {
  const [open, setOpen] = useState(false);
  const gated = !!disabledReason;

  return (
    <div className="flex flex-col gap-1 items-end">
      <Button
        type="button"
        variant="secondary"
        onClick={() => !gated && setOpen(true)}
        disabled={gated}
        title={disabledReason ?? undefined}
      >
        <Clapperboard className="h-4 w-4" />
        Generate Video
      </Button>

      {/* Task 2: explain WHY it's disabled — never a dead button. */}
      {gated && <p className="text-3xs text-white/40 max-w-[260px] text-right">{disabledReason}</p>}

      <VideoConfigModal
        open={open}
        brandId={brandId}
        contentItemId={contentItemId}
        contentTitle={contentTitle}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
