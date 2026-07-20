/**
 * OttoFlow Creative OS — Typography Engine (Phase 2).
 *
 * A pure, deterministic resolver: semantic role + frame → a concrete type spec
 * (fontPx / weight / trackingPx / leadingMult / case), driven entirely by the
 * Phase 11 token dictionary. This is the token-driven equivalent of the existing
 * per-style typography decision in presentation/styles/core.ts (applyStyle) — but
 * sourced from ONE canonical scale rather than hardcoded per style, so registers
 * can tune a shared foundation later.
 *
 * The output `TypeSpec` matches the production `beat.type` IR exactly, so the
 * engine drops into the presentation pipeline without any compiler change. It is
 * consumed only via the opt-in pass + Render Profile mechanism — never by default.
 *
 * Purity: no clock, no I/O, no globals. Width measurement is injected so the
 * engine has no dependency on the render layer and stays trivially testable.
 */
import { TYPOGRAPHY_TOKENS, TYPOGRAPHY_FIT, type TypographyRole } from "../tokens/typography";

/** Concrete, resolved type for one beat — identical shape to production beat.type. */
export interface TypeSpec {
  role: string;
  fontPx: number;
  weight: number;
  trackingPx: number;
  leadingMult: number;
  case: "sentence" | "upper" | "title";
}

/** Injected width estimator: (text, fontPx, trackingPx) → estimated px width.
 * The production estimateWidthPx (presentation/grouping) satisfies this shape. */
export type WidthMeasure = (text: string, fontPx: number, trackingPx: number) => number;

/**
 * Resolve a role to its base type spec at a given frame height. Sizes scale
 * linearly with the frame (tokens are authored against 1920). Deterministic.
 */
export function resolveTypeSpec(role: TypographyRole, frameHeight: number): TypeSpec {
  const t = TYPOGRAPHY_TOKENS[role];
  const fontPx = Math.max(1, Math.round(t.sizePct * frameHeight));
  const trackingPx = Math.round(t.trackingPct * fontPx);
  return { role, fontPx, weight: t.weight, trackingPx, leadingMult: t.leadingMult, case: t.case };
}

/**
 * Resolve a role AND shrink it until the widest line fits the safe band — the
 * overflow guard, kept behaviour-identical to the production applyStyle fit
 * (safe width 84%, readable floor ~4.2%H, step ~0.4%H, tracking stays
 * proportional). Big roles are used when they fit and step down gracefully on
 * longer lines; nothing ever clips. Pure — width is measured via `measure`.
 */
export function fitTypeSpec(
  role: TypographyRole,
  lines: string[][],
  frame: { width: number; height: number },
  measure: WidthMeasure,
): TypeSpec {
  const t = TYPOGRAPHY_TOKENS[role];
  const safeWidth = Math.round(frame.width * TYPOGRAPHY_FIT.safeWidthPct);
  const minPx = Math.round(TYPOGRAPHY_FIT.minSizePct * frame.height);
  const step = Math.max(2, Math.round(TYPOGRAPHY_FIT.stepPct * frame.height));
  let fontPx = Math.max(1, Math.round(t.sizePct * frame.height));
  let trackingPx = Math.round(t.trackingPct * fontPx);
  const widest = () =>
    lines.length
      ? Math.max(...lines.map((l) => measure(l.join(" "), fontPx, Math.max(0, trackingPx))))
      : 0;
  while (fontPx > minPx && widest() > safeWidth) {
    fontPx -= step;
    trackingPx = Math.round(t.trackingPct * fontPx);
  }
  return { role, fontPx, weight: t.weight, trackingPx, leadingMult: t.leadingMult, case: t.case };
}
