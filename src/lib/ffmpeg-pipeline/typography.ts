/**
 * OttoFlow Premium Typography System (Video Quality V3, Phase 1).
 *
 * The single source of truth for the 14 named type roles defined in
 * docs/OTTOFLOW_PREMIUM_VIDEO_STYLE_GUIDE.md §1. Pure + dependency-free so it can
 * be imported by ass-captions.ts (captions) and branding.ts (end screen) without
 * any pipeline coupling, and unit-tested in isolation.
 *
 * FOUNDATION ONLY — Phase 1 introduces NO behaviour change: nothing consumes these
 * roles yet (later phases wire the ANIMATED caption path + CTA card to them, all
 * feature-gated behind Modern render profiles). Legacy output stays byte-identical.
 *
 * Sizes are authored as a FRACTION OF FRAME HEIGHT (`sizePctH`) against a 1920-tall
 * reference so they scale to 9:16 (1080×1920), 1:1 (1080×1080) and 16:9
 * (1920×1080). `resolveRole(role, frameHeight)` returns concrete pixel values.
 *
 * FONTS: Modern profiles use the bundled premium faces (Sora / Plus Jakarta Sans /
 * IBM Plex Mono — OFL `.ttf` assets, no provider/SDK). Legacy stays "DejaVu Sans",
 * unchanged. libass resolves a face by family NAME, so the family strings here must
 * match the bundled font's internal family name and be visible to libass via the
 * ass filter `fontsdir` (wired, feature-gated, in the fonts sub-step of Phase 1).
 */

/** Premium bundled families (Modern) + the Legacy family (unchanged). */
export const FONT = {
  /** Geometric display face — big/branded moments. */
  SORA: "Sora",
  /** Humanist UI sans — fast-reading caption bodies. */
  JAKARTA: "Plus Jakarta Sans",
  /** Monospace — technical overlays only (numbers/data/timestamps). */
  MONO: "IBM Plex Mono",
  /** Legacy production face — never changed. */
  LEGACY: "DejaVu Sans",
} as const;

export type FontFamily = (typeof FONT)[keyof typeof FONT];

export type TypographyRoleName =
  | "display_xl"
  | "display"
  | "hero"
  | "headline"
  | "subheadline"
  | "body"
  | "caption"
  | "keyword"
  | "cta"
  | "button"
  | "brand"
  | "footer"
  | "watermark"
  | "micro";

export interface TypographyRole {
  /** Bundled family (Modern). */
  face: FontFamily;
  /** libass Bold flag (1 = bold) — DejaVu/most faces expose a bold; heavier
   * weights (600/800) are approximated by the face's bold + stroke until the
   * specific weight file is bundled. */
  bold: 0 | 1;
  /** Numeric design weight from the Style Guide (documentation/intent). */
  weight: 400 | 500 | 600 | 700 | 800;
  /** Font size as a fraction of frame HEIGHT (1920-ref). */
  sizePctH: number;
  /** Letter spacing (px @1920 reference; scaled in resolveRole). */
  trackingPx: number;
  /** Line height as a percentage of font size. */
  lineHeightPct: number;
  /** Outline width (px @1920 ref). */
  strokePx: number;
  /** Drop shadow depth (px @1920 ref). */
  shadowPx: number;
  /** Max text width as a fraction of frame WIDTH (0..1). null = n/a (corner). */
  maxWidthPctW: number | null;
  /** Max rendered lines. */
  maxLines: number;
  /** Layout intent. */
  align: "center" | "corner";
  /** Case transform intent. */
  case: "none" | "upper" | "sentence";
  /** Opacity 0..1 (1 = opaque). */
  opacity: number;
}

/** 14 roles, verbatim from Style Guide §1 (px@1920 shown in comments). */
export const TYPOGRAPHY: Record<TypographyRoleName, TypographyRole> = {
  //                        face          bold weight sizePctH        track  LH   stroke shadow maxW  lines align      case        opacity
  display_xl:  { face: FONT.SORA,    bold: 1, weight: 800, sizePctH: 132 / 1920, trackingPx: -1.0, lineHeightPct: 96,  strokePx: 8, shadowPx: 6, maxWidthPctW: 0.86, maxLines: 1, align: "center", case: "upper",    opacity: 1 },
  display:     { face: FONT.SORA,    bold: 1, weight: 800, sizePctH: 116 / 1920, trackingPx: -0.5, lineHeightPct: 98,  strokePx: 7, shadowPx: 5, maxWidthPctW: 0.86, maxLines: 2, align: "center", case: "upper",    opacity: 1 },
  hero:        { face: FONT.SORA,    bold: 1, weight: 700, sizePctH: 100 / 1920, trackingPx: 0.0,  lineHeightPct: 100, strokePx: 6, shadowPx: 5, maxWidthPctW: 0.84, maxLines: 2, align: "center", case: "upper",    opacity: 1 },
  headline:    { face: FONT.SORA,    bold: 1, weight: 700, sizePctH: 84 / 1920,  trackingPx: 0.5,  lineHeightPct: 104, strokePx: 5, shadowPx: 4, maxWidthPctW: 0.84, maxLines: 2, align: "center", case: "sentence", opacity: 1 },
  subheadline: { face: FONT.JAKARTA, bold: 1, weight: 600, sizePctH: 72 / 1920,  trackingPx: 0.5,  lineHeightPct: 108, strokePx: 4, shadowPx: 3, maxWidthPctW: 0.82, maxLines: 2, align: "center", case: "sentence", opacity: 1 },
  body:        { face: FONT.JAKARTA, bold: 0, weight: 400, sizePctH: 60 / 1920,  trackingPx: 0.3,  lineHeightPct: 118, strokePx: 3, shadowPx: 2, maxWidthPctW: 0.80, maxLines: 3, align: "center", case: "sentence", opacity: 1 },
  caption:     { face: FONT.JAKARTA, bold: 1, weight: 700, sizePctH: 76 / 1920,  trackingPx: 0.5,  lineHeightPct: 112, strokePx: 5, shadowPx: 3, maxWidthPctW: 0.84, maxLines: 2, align: "center", case: "sentence", opacity: 1 },
  // keyword is a MODIFIER applied to its line's role: +6% scale, accent color,
  // +1 stroke. sizePctH here is the relative scale factor (1.06), not a height %.
  keyword:     { face: FONT.JAKARTA, bold: 1, weight: 700, sizePctH: 1.06,       trackingPx: 0.5,  lineHeightPct: 100, strokePx: 1, shadowPx: 0, maxWidthPctW: null, maxLines: 1, align: "center", case: "none",     opacity: 1 },
  cta:         { face: FONT.SORA,    bold: 1, weight: 700, sizePctH: 84 / 1920,  trackingPx: 1.0,  lineHeightPct: 108, strokePx: 5, shadowPx: 4, maxWidthPctW: 0.80, maxLines: 2, align: "center", case: "sentence", opacity: 1 },
  button:      { face: FONT.SORA,    bold: 1, weight: 600, sizePctH: 52 / 1920,  trackingPx: 1.5,  lineHeightPct: 100, strokePx: 3, shadowPx: 2, maxWidthPctW: 0.60, maxLines: 1, align: "center", case: "upper",    opacity: 1 },
  brand:       { face: FONT.JAKARTA, bold: 0, weight: 500, sizePctH: 44 / 1920,  trackingPx: 3.0,  lineHeightPct: 100, strokePx: 0, shadowPx: 2, maxWidthPctW: 0.70, maxLines: 1, align: "center", case: "none",     opacity: 0.85 },
  footer:      { face: FONT.JAKARTA, bold: 0, weight: 400, sizePctH: 34 / 1920,  trackingPx: 1.0,  lineHeightPct: 120, strokePx: 0, shadowPx: 1, maxWidthPctW: 0.70, maxLines: 1, align: "center", case: "none",     opacity: 0.75 },
  watermark:   { face: FONT.JAKARTA, bold: 0, weight: 500, sizePctH: 38 / 1920,  trackingPx: 0.0,  lineHeightPct: 100, strokePx: 0, shadowPx: 2, maxWidthPctW: null, maxLines: 1, align: "corner", case: "none",     opacity: 0.85 },
  micro:       { face: FONT.JAKARTA, bold: 0, weight: 400, sizePctH: 28 / 1920,  trackingPx: 0.5,  lineHeightPct: 120, strokePx: 0, shadowPx: 1, maxWidthPctW: 0.60, maxLines: 2, align: "center", case: "none",     opacity: 0.60 },
};

export interface ResolvedRole {
  face: FontFamily;
  bold: 0 | 1;
  fontSizePx: number;
  trackingPx: number;
  lineHeightPx: number;
  strokePx: number;
  shadowPx: number;
  maxWidthPx: number | null;
  maxLines: number;
  align: "center" | "corner";
  case: "none" | "upper" | "sentence";
  opacity: number;
}

/**
 * Resolve a role to concrete pixels for a given output frame. `keyword` is a
 * modifier (relative scale), so it is resolved against a base font size.
 */
export function resolveRole(
  role: TypographyRoleName,
  frame: { width: number; height: number },
  baseFontSizePx?: number,
): ResolvedRole {
  const r = TYPOGRAPHY[role];
  const scale = frame.height / 1920; // tracking/stroke authored @1920 ref
  const fontSizePx =
    role === "keyword"
      ? Math.round((baseFontSizePx ?? Math.round(TYPOGRAPHY.caption.sizePctH * frame.height)) * r.sizePctH)
      : Math.round(r.sizePctH * frame.height);
  return {
    face: r.face,
    bold: r.bold,
    fontSizePx,
    trackingPx: +(r.trackingPx * scale).toFixed(2),
    lineHeightPx: Math.round((fontSizePx * r.lineHeightPct) / 100),
    strokePx: +(r.strokePx * scale).toFixed(2),
    shadowPx: +(r.shadowPx * scale).toFixed(2),
    maxWidthPx: r.maxWidthPctW == null ? null : Math.round(r.maxWidthPctW * frame.width),
    maxLines: r.maxLines,
    align: r.align,
    case: r.case,
    opacity: r.opacity,
  };
}

/** Safe-area rails (px @1920 ref) from Style Guide §2. */
export const SAFE_AREA = {
  sidePx: 120,
  topPx: 220,
  bottomPx: 320,
  /** Caption vertical band as fractions of height (lower-middle third). */
  captionBand: { top: 0.55, bottom: 0.78 },
  /** Base vertical rhythm unit (px @1920). */
  gridUnitPx: 20,
} as const;
