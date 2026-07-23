/**
 * OttoFlow Creative OS — Layout token dictionary (Phase 4).
 *
 * The canonical composition values from the Layout System (Phase 7) and Design
 * Tokens (Phase 11 §3), expressed as data: platform safe zones, the density
 * ceiling, layer order, and the frame margin. Pure — no logic, no rendering.
 *
 * Coordinate space: values are fractions of the frame so they scale to any size,
 * resolved to px in the same PlayRes/top-left space the production layout
 * primitives use (presentation/primitives/layout.ts). Safe-zone insets: top/bottom
 * are fractions of HEIGHT, left/right of WIDTH. Nothing here is wired into a
 * render; it is consumed only through the engine + Render Profile mechanism.
 */

/** Supported output aspects. */
export type Aspect = "9:16" | "1:1" | "16:9";

/** Safe-zone insets as frame fractions (the platform-reserved margins). */
export interface SafeZoneFrac {
  topPct: number;
  bottomPct: number;
  leftPct: number;
  rightPct: number;
}

export const ASPECTS: readonly Aspect[] = ["9:16", "1:1", "16:9"];

/**
 * Platform safe zones. 9:16 reserves the most at the BOTTOM (caption/handle/CTA
 * band) and a wider RIGHT inset (the action rail) — meaning never sits under UI.
 * Values trace to Design Tokens §3 (9:16: top≈220, bottom≈320, right≈180 on
 * 1080×1920).
 */
export const SAFE_ZONES: Record<Aspect, SafeZoneFrac> = {
  "9:16": { topPct: 0.115, bottomPct: 0.167, leftPct: 0.11, rightPct: 0.167 },
  "1:1": { topPct: 0.08, bottomPct: 0.14, leftPct: 0.08, rightPct: 0.14 },
  "16:9": { topPct: 0.08, bottomPct: 0.16, leftPct: 0.06, rightPct: 0.1 },
};

/** Density ceiling — max competing elements per frame (one idea, held with room). */
export const LAYOUT_DENSITY = { maxElements: 4 } as const;

/** Depth order: ground (atmosphere) → subject → message (always wins the read) →
 * frame (the quiet edge). Fixed z-semantics. */
export const LAYER_ORDER = ["ground", "subject", "message", "frame"] as const;
export type Layer = (typeof LAYER_ORDER)[number];

/** General inviolable edge breathing room as a fraction of width (~96px @1080). */
export const FRAME_MARGIN_PCT = 0.089;
