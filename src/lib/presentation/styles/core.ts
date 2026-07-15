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
import { estimateWidthPx } from "../grouping";
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
export function applyStyle(style: StyleFamily, beats: Beat[], frame: { width: number; height: number }): Beat[] {
  try {
    const safeWidth = Math.round(frame.width * 0.84);
    const minPx = Math.round(0.042 * frame.height); // never smaller than a readable caption
    const step = Math.max(2, Math.round(0.004 * frame.height));
    return beats.map((b) => {
      const treatment = asTreatment(b.treatment);
      const totalWords = b.lines.reduce((a, l) => a + l.words.length, 0);
      const archetype = chooseArchetype(style, treatment, totalWords);
      // Layout ↔ Typography coupling: a hero LAYOUT implies a hero SIZE. A 1-word
      // beat becomes a single-word hero (biggest); a 2-word beat a display. So a
      // short beat commands the frame regardless of its narrative treatment.
      let role = style.roleByTreatment[treatment] ?? "body";
      if (archetype === "single-word-hero") role = "hero";
      else if (archetype === "dual-word-hero") role = "display";
      const rt = style.type[role] ?? style.type.body;
      // Typography Engine OWNS fit: start at the role's size, shrink until the
      // widest line fits the safe band, keeping tracking proportional. So a big
      // hero/statistic size is used when it fits (short beats) and steps down
      // gracefully on longer lines — no clipping, hierarchy where there's room.
      let fontPx = Math.round(rt.sizePct * frame.height);
      let trackingPx = Math.round(rt.trackingPct * fontPx);
      const widest = () =>
        Math.max(...b.lines.map((l) => estimateWidthPx(l.words.join(" "), fontPx, Math.max(0, trackingPx))));
      while (fontPx > minPx && widest() > safeWidth) {
        fontPx -= step;
        trackingPx = Math.round(rt.trackingPct * fontPx);
      }
      const motion = style.motionByTreatment[treatment] ?? style.motionByTreatment.statement;
      return {
        ...b,
        role,
        type: { role, fontPx, weight: rt.weight, trackingPx, leadingMult: rt.leadingMult, case: rt.case },
        // (fontPx/trackingPx are post-overflow-guard — the compiler uses them as-is)
        layout: { ...(b.layout ?? {}), archetype, align: 5 },
        motion: { ...(b.motion ?? {}), ...motion },
      };
    });
  } catch {
    return beats;
  }
}
