/**
 * OttoFlow Creative OS — QA token dictionary (Phase 7).
 *
 * The ten evaluation dimensions from the Design QA System (Phase 10) as data,
 * with register-neutral weights and the verdict labels. Pure — no logic, no
 * rendering. The QA Engine reads these to score a candidate; the per-register Pass
 * threshold (θ) comes from the Register tokens.
 *
 * The QA Engine is ADVISORY ONLY (report-only) — it evaluates and scores; it never
 * blocks a render and no render path depends on it.
 */

/** The ten QA dimensions (Design QA System §1–10). */
export type QaDimension =
  | "typography" | "motion" | "layout" | "captions" | "story"
  | "register" | "ending" | "brand" | "accessibility" | "production";

export const QA_DIMENSIONS: readonly QaDimension[] = [
  "typography", "motion", "layout", "captions", "story",
  "register", "ending", "brand", "accessibility", "production",
];

/**
 * Register-neutral quality weights (sum = 1). Registers may re-weight above the
 * floor in a later cycle; the hard gates are never weighted (a failed gate rejects
 * regardless). Accessibility and production carry a little more as reliability
 * dimensions; the rest are even.
 */
export const QA_WEIGHTS: Record<QaDimension, number> = {
  typography: 0.1,
  motion: 0.1,
  layout: 0.1,
  captions: 0.1,
  story: 0.1,
  register: 0.1,
  ending: 0.1,
  brand: 0.1,
  accessibility: 0.1,
  production: 0.1,
};

/** The three advisory verdicts. */
export type QaVerdict = "reject" | "revise" | "pass";
export const QA_VERDICTS: readonly QaVerdict[] = ["reject", "revise", "pass"];

/** Fallback Pass threshold when a register θ is not supplied (0–100 scale). */
export const QA_DEFAULT_THRESHOLD = 82;
