/**
 * TYPOGRAPHY primitives — deterministic type-treatment rules (letter-spacing, hierarchy)
 * distilled from editorial/luxury typography: large display type reads premium with
 * TIGHTER tracking; small type needs LOOSER tracking to stay legible. Pure functions —
 * reusable across every philosophy (a philosophy declares "opticalTracking" and the
 * compiler applies this rule; no per-philosophy tracking tables to hand-tune).
 */

/**
 * OPTICAL TRACKING — resolve a `\fsp` letter-spacing (px) for a font size, as a size-
 * relative rule (fraction of the frame height sets the "voice" of the type). Deterministic:
 *   hero/display (≥6.5%H) → tight (−2.2%) · headline (≥5%H) → slightly tight (−1.2%) ·
 *   body → neutral · caption (≤4.2%H) → loose (+1.2%) · micro (≤3.2%H) → looser (+3%).
 * Returns a signed integer px (0 = neutral). Never throws.
 */
export function opticalTracking(fontPx: number, frameH: number): number {
  const ratio = fontPx / Math.max(1, frameH);
  if (ratio >= 0.065) return -Math.round(fontPx * 0.022);
  if (ratio >= 0.05) return -Math.round(fontPx * 0.012);
  if (ratio <= 0.032) return Math.round(fontPx * 0.03);
  if (ratio <= 0.042) return Math.round(fontPx * 0.012);
  return 0;
}

/** The `\fsp` fragment for an optical-tracking value (empty when neutral). */
export function trackingTag(fontPx: number, frameH: number): string {
  const fsp = opticalTracking(fontPx, frameH);
  return fsp !== 0 ? `\\fsp${fsp}` : "";
}

/**
 * HIERARCHY STEP — the modular step between two role sizes as a ratio. Premium's
 * "obvious-modular-step" wants ≥1.5× hero↔body; this exposes the check/derivation as a
 * primitive so a philosophy can enforce or derive sizes rather than hand-picking them.
 */
export function hierarchyStep(largerPx: number, smallerPx: number): number {
  return smallerPx > 0 ? largerPx / smallerPx : 1;
}
