/**
 * Image Typography bridge (COS migration M2C) — the SVG compositor's binding to
 * the SHARED Creative OS design tokens. It resolves nothing itself: given a
 * user-facing text style, it looks up the philosophy id in the shared text-style
 * registry and reads the SAME StyleFamily tokens (fonts / role type specs / fx)
 * the video (ASS) engine uses. No style value is defined here — one design
 * language, two renderers.
 *
 *   text style ──(text-style-registry: philosophyId)──▶ presentation StyleFamily
 *                                                        │
 *                            fonts.display · type.headline/body/cta · fx.outline
 *                                                        ▼
 *                                    ImageTypography  ──▶ compositor SVG layers
 *
 * `legacy` (and any unknown id) resolves to null → the compositor keeps its
 * existing deterministic typography, byte-for-byte. So enabling a Creative OS
 * style is purely additive; the default render is unchanged.
 */
import { getTextStyle, type TextStyleId } from "@/lib/creative-os/text-style-registry";
import { getStyleFamily } from "@/lib/presentation/styles/registry";

export type TextCase = "sentence" | "upper" | "title";

/** The registry-derived typography the SVG compositor consumes for one style. */
export interface ImageTypography {
  /** Provenance: the resolved philosophy id (e.g. "premium"). */
  styleId: string;
  /** Display font family to PREPEND to the compositor's fallback stack; null =
   *  keep the compositor's default stack (the font may be absent on the host —
   *  librsvg then falls back down the chain, deterministically). */
  displayFont: string | null;
  headline: { weight: number; textCase: TextCase; trackingEm: number };
  sub: { weight: number; textCase: TextCase };
  cta: { weight: number; textCase: TextCase };
  /** Headline stroke width (px), derived from the philosophy's libass outline. */
  headlineStrokePx: number;
}

/**
 * Resolve a user text style → the compositor's typography tokens, read straight
 * from the shared StyleFamily. Returns null for legacy / unknown / a style whose
 * philosophy isn't registered → caller uses its existing literals (byte-safe).
 */
export function resolveImageTypography(
  styleId: TextStyleId | string | null | undefined,
): ImageTypography | null {
  if (!styleId || styleId === "legacy") return null;
  const def = getTextStyle(styleId as TextStyleId);
  const fam = getStyleFamily(def.philosophyId);
  if (!fam) return null;
  const h = fam.type.headline;
  const b = fam.type.body;
  const c = fam.type.cta;
  return {
    styleId: fam.id,
    displayFont: fam.fonts.display || null,
    headline: { weight: h.weight, textCase: h.case, trackingEm: h.trackingPct },
    sub: { weight: b.weight, textCase: b.case },
    cta: { weight: c.weight, textCase: c.case },
    // The ASS outline (premium 4 · impact 7) is tuned for white-over-footage; the
    // still already has a legibility scrim, so scale it to a subtle SVG edge with
    // a floor at today's 2px baseline (legacy path never calls this).
    headlineStrokePx: Math.max(2, Math.round(fam.fx.outlinePx * 0.6)),
  };
}

/** Apply a style's case transform. `sentence` = identity (byte-safe default). */
export function applyCase(text: string, c: TextCase): string {
  if (c === "upper") return text.toUpperCase();
  if (c === "title") return text.replace(/\b(\w)/g, (m) => m.toUpperCase());
  return text;
}
