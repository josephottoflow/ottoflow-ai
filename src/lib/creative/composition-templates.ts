/**
 * Composition templates (P4 Phase 2A) — a brand's SPATIAL signature.
 *
 * Orthogonal to hierarchy: the template decides WHERE weight/text/safe-zones
 * sit (the brand's grammar); hierarchy decides WHICH element is hero + font
 * sizing (the content's emphasis). The compositor blends them:
 *
 *     Final layout = template(brand) × hierarchy(content)
 *
 * Pure data — no rendering here. When a brand has no active pattern the
 * compositor ignores this entirely and uses its existing per-hierarchy
 * defaults (zero regression).
 */
import type {
  CompositionTemplate,
  CreativeHierarchy,
  MotifPlacement,
  Placement,
} from "./types";

export interface TemplateLayout {
  /** Headline anchor + start position as canvas ratios. */
  anchor: "start" | "middle";
  headlineStartYRatio: number;
  headlineXRatio: number;       // 0..1 (used when anchor=middle); start uses margin
  headlineMaxWidthRatio: number;
  /** CTA strategy. */
  cta: "below_headline" | "fixed_bottom" | "fixed_center";
  ctaYRatio?: number;           // for fixed_* modes
  /** Default placements when the brief doesn't pin one. */
  logoBias: Placement;
  headshotBias: Placement;
  /** Negative-space / margin ratio (overrides the compositor's fixed 0.05). */
  marginRatio: number;
  /** Where the motif anchors for this template. */
  motifPlacement: MotifPlacement;
}

const BASE: Record<CompositionTemplate, TemplateLayout> = {
  center_convergence: {
    anchor: "middle", headlineStartYRatio: 0.30, headlineXRatio: 0.5, headlineMaxWidthRatio: 0.80,
    cta: "below_headline", logoBias: "bottom_right", headshotBias: "bottom_left",
    marginRatio: 0.06, motifPlacement: "center_bleed",
  },
  diagonal_precision: {
    anchor: "start", headlineStartYRatio: 0.24, headlineXRatio: 0.0, headlineMaxWidthRatio: 0.60,
    cta: "below_headline", logoBias: "bottom_left", headshotBias: "right_third",
    marginRatio: 0.05, motifPlacement: "edge",
  },
  orbital_growth: {
    anchor: "start", headlineStartYRatio: 0.32, headlineXRatio: 0.0, headlineMaxWidthRatio: 0.55,
    cta: "below_headline", logoBias: "bottom_right", headshotBias: "right_third",
    marginRatio: 0.06, motifPlacement: "corner",
  },
  grid_authority: {
    anchor: "start", headlineStartYRatio: 0.20, headlineXRatio: 0.0, headlineMaxWidthRatio: 0.55,
    cta: "fixed_bottom", ctaYRatio: 0.82, logoBias: "top_left", headshotBias: "bottom_left",
    marginRatio: 0.055, motifPlacement: "full_tile",
  },
  open_canvas: {
    anchor: "middle", headlineStartYRatio: 0.40, headlineXRatio: 0.5, headlineMaxWidthRatio: 0.70,
    cta: "below_headline", logoBias: "bottom_right", headshotBias: "bottom_left",
    marginRatio: 0.08, motifPlacement: "center_bleed",
  },
};

/**
 * Resolve the layout for a template, folding in the hierarchy's hero rules.
 * Hierarchy overrides keep founder/brand emphasis intact regardless of template.
 */
export function getTemplateLayout(
  template: CompositionTemplate,
  hierarchy: CreativeHierarchy,
): TemplateLayout {
  const base = BASE[template];
  switch (hierarchy) {
    case "founder_led":
      // Headshot is hero → text reads beside it (left), portrait to the side.
      return { ...base, anchor: "start", headshotBias: "right_third" };
    case "brand_led":
      // Logo is hero center → headline owns the upper area, CTA lower.
      return { ...base, cta: "fixed_center", ctaYRatio: base.ctaYRatio ?? 0.74, logoBias: "center" };
    case "quote_led":
      // Typographic quote moment — keep template grammar, give it room.
      return { ...base, headlineMaxWidthRatio: Math.min(0.8, base.headlineMaxWidthRatio + 0.1) };
    case "data_led":
    case "product_led":
    default:
      return base;
  }
}
