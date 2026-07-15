/**
 * Presentation Core (V5) — the Typography, Layout and Style engines working
 * together as ONE pure step. Given a StyleFamily + beats (already grouped and
 * treatment-tagged by Beat Analysis), it decides, per beat:
 *   • Typography Engine — semantic role (style.roleByTreatment) → concrete look
 *     (style.type[role]) → beat.type {fontPx, weight, trackingPx, leadingMult, case}
 *   • Layout Engine — archetype (auto: 1 word → single-word-hero, 2 → dual-word-
 *     hero, else style.layoutByTreatment) + alignment
 *   • Style/Motion — beat.motion signature (style.motionByTreatment)
 * Pure and deterministic; NO rendering, NO ASS. The ASS compiler consumes the
 * result and serializes it — it makes no design decisions.
 */
import type { Beat } from "../types";
import type { StyleFamily, TreatmentId, LayoutArchetype } from "./types";

const TREATMENTS: TreatmentId[] = ["hook", "stat", "turn", "question", "cta", "statement"];
const asTreatment = (t?: string): TreatmentId =>
  (t && (TREATMENTS as string[]).includes(t) ? t : "statement") as TreatmentId;

/** Layout Engine: the style's per-treatment archetype, overridden by word-count
 * so a genuinely short beat becomes a hero screen (the biggest "not-a-subtitle"
 * win) regardless of style default. */
function chooseArchetype(style: StyleFamily, treatment: TreatmentId, totalWords: number): LayoutArchetype {
  if (treatment === "stat") return "number";
  if (totalWords === 1) return "single-word-hero";
  if (totalWords === 2) return "dual-word-hero";
  return style.layoutByTreatment[treatment] ?? "centered";
}

/**
 * Apply a style to beats → enriched IR. `frameHeight` converts the style's
 * fraction-of-height sizes into px. Fail-safe: returns the input beats unchanged
 * on any error so a style can never break a render.
 */
export function applyStyle(style: StyleFamily, beats: Beat[], frameHeight: number): Beat[] {
  try {
    return beats.map((b) => {
      const treatment = asTreatment(b.treatment);
      const totalWords = b.lines.reduce((a, l) => a + l.words.length, 0);
      const role = style.roleByTreatment[treatment] ?? "body";
      const rt = style.type[role] ?? style.type.body;
      const fontPx = Math.round(rt.sizePct * frameHeight);
      const trackingPx = Math.round(rt.trackingPct * fontPx);
      const archetype = chooseArchetype(style, treatment, totalWords);
      const motion = style.motionByTreatment[treatment] ?? style.motionByTreatment.statement;
      return {
        ...b,
        role,
        type: { role, fontPx, weight: rt.weight, trackingPx, leadingMult: rt.leadingMult, case: rt.case },
        layout: { ...(b.layout ?? {}), archetype, align: 5 },
        motion: { ...(b.motion ?? {}), ...motion },
      };
    });
  } catch {
    return beats;
  }
}
