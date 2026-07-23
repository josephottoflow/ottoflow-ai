/**
 * OttoFlow Creative OS — Typography token dictionary (Phase 2).
 *
 * The canonical, register-neutral type scale from the Design Tokens document
 * (Phase 11 §1), expressed as data. This is the SINGLE source of typographic
 * values the Typography Engine resolves against; registers (a later cycle) tune
 * these within their permitted ranges. Pure data — no logic, no rendering.
 *
 * Compatibility: `RoleTypeToken` intentionally mirrors the production
 * `RoleTypeSpec` shape (sizePct / weight / trackingPct / leadingMult / case) in
 * presentation/styles/types.ts, so a token resolves cleanly into the existing
 * `beat.type` IR the ASS compiler already serializes. Nothing here is wired into
 * a render; it is consumed only through the engine + Render Profile mechanism.
 *
 * Sizes are a fraction of frame height on the reference 1080×1920 canvas and
 * scale with any frame. Tracking is a fraction of the resolved font size.
 */

/** The canonical semantic roles (Typography System §1). */
export type TypographyRole =
  | "display" // the one line that carries the beat
  | "lead" // the emphasised line / clause
  | "subhead" // orientation / secondary
  | "caption" // spoken word, read in motion (larger than body by design)
  | "body" // the idea in full
  | "label" // the quiet frame — kicks, tags (all-caps)
  | "numeral"; // figures that must land (tabular)

/** How a role looks. Mirrors production RoleTypeSpec so it drops into beat.type. */
export interface RoleTypeToken {
  /** Font height as a fraction of frame height (reference 1920). */
  sizePct: number;
  /** 400 regular · 500 medium · 600 semibold · 700 bold · 800 black. */
  weight: 400 | 500 | 600 | 700 | 800;
  /** Letter-spacing as a fraction of font size (+ looser · − tighter). Optical. */
  trackingPct: number;
  /** Line-height multiplier. */
  leadingMult: number;
  case: "sentence" | "upper" | "title";
}

/** The reference canvas the sizePct values are authored against. */
export const TYPOGRAPHY_REFERENCE_FRAME = { width: 1080, height: 1920 } as const;

/** Modular scale ratio between adjacent meaning levels (major third). */
export const TYPE_SCALE_RATIO = 1.25;

/**
 * Overflow-fit constants — kept identical to the production applyStyle path
 * (safe width 84%, readable floor ~4.2%H, ~0.4%H step) so the engine's fit
 * behaviour matches existing convention rather than inventing a new one.
 */
export const TYPOGRAPHY_FIT = {
  safeWidthPct: 0.84,
  minSizePct: 0.042,
  stepPct: 0.004,
} as const;

/**
 * The canonical role → look table. Values trace to Design Tokens §1
 * (display 132 / lead 96 / subhead 72 / caption 64 / body 48 / label 34 px on
 * 1920; numeral ties display). Register-neutral defaults; registers tune later.
 */
export const TYPOGRAPHY_TOKENS: Record<TypographyRole, RoleTypeToken> = {
  display: { sizePct: 0.0688, weight: 700, trackingPct: -0.015, leadingMult: 1.04, case: "sentence" },
  lead: { sizePct: 0.05, weight: 600, trackingPct: -0.01, leadingMult: 1.08, case: "sentence" },
  subhead: { sizePct: 0.0375, weight: 600, trackingPct: -0.005, leadingMult: 1.12, case: "sentence" },
  caption: { sizePct: 0.0333, weight: 700, trackingPct: 0.005, leadingMult: 1.2, case: "sentence" },
  body: { sizePct: 0.025, weight: 400, trackingPct: 0, leadingMult: 1.4, case: "sentence" },
  label: { sizePct: 0.0177, weight: 500, trackingPct: 0.08, leadingMult: 1.1, case: "upper" },
  numeral: { sizePct: 0.0688, weight: 700, trackingPct: -0.01, leadingMult: 1.0, case: "sentence" },
};

/** Roles in descending size order (a stable, iterable list). */
export const TYPOGRAPHY_ROLES: readonly TypographyRole[] = [
  "display",
  "numeral",
  "lead",
  "subhead",
  "caption",
  "body",
  "label",
];
