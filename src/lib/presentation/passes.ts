/**
 * Presentation Engine passes (Phase 1 foundation — identity no-ops).
 *
 * These are the 8 canonical passes. In Phase 1 each returns the model UNCHANGED
 * (identity), so the engine has zero behavioural effect. Later phases replace the
 * body of individual passes:
 *   Pass 1 Sentence Analysis   → tokenise + boundary/emphasis-tag map
 *   Pass 2 Caption Grouping    → 1–3 word beats (deterministic)
 *   Pass 3 Keyword Selection   → priority-lexicon keyword per line
 *   Pass 4 Typography Layout   → per-beat role + positioned/wrapped lines
 *   Pass 5 Motion Planning     → per-beat entrance/emphasis motion spec
 *   Pass 6 Overflow Detection  → shrink/re-chunk when a line exceeds max width
 *   Pass 7 Safe Area Validation→ clamp into the safe caption band
 *   Pass 8 Presentation QA     → advisory scores + flags (non-blocking)
 *
 * Contract: pure, deterministic, must not throw for control flow (the engine also
 * guards each with try/catch). Replacing a pass NEVER touches the others.
 */
import type { PresentationModel, PresentationPass } from "./types";

const identity = (name: string): PresentationPass => ({
  name,
  run: (model: PresentationModel): PresentationModel => model,
});

export const sentenceAnalysisPass: PresentationPass = identity("sentence-analysis");
export const captionGroupingPass: PresentationPass = identity("caption-grouping");
export const keywordSelectionPass: PresentationPass = identity("keyword-selection");
export const typographyLayoutPass: PresentationPass = identity("typography-layout");
export const motionPlanningPass: PresentationPass = identity("motion-planning");
export const overflowDetectionPass: PresentationPass = identity("overflow-detection");
export const safeAreaValidationPass: PresentationPass = identity("safe-area-validation");
export const presentationQaPass: PresentationPass = identity("presentation-qa");

/** The canonical ordered pipeline. */
export const DEFAULT_PASSES: readonly PresentationPass[] = [
  sentenceAnalysisPass,
  captionGroupingPass,
  keywordSelectionPass,
  typographyLayoutPass,
  motionPlanningPass,
  overflowDetectionPass,
  safeAreaValidationPass,
  presentationQaPass,
];
