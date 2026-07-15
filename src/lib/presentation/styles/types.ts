/**
 * Presentation Engine V5 — Motion Typography STYLE system (data-driven).
 *
 * A StyleFamily is DATA, not code: it fully parameterises the Typography, Layout,
 * Motion, Emphasis, CTA, Ending, Colour and Rhythm engines. Adding a new style
 * (Rolex, MrBeast V2, …) is authoring a new config object in this folder — NO
 * engine changes. The engines read these tables; the ASS compiler serializes the
 * decided result. Nothing here renders; nothing here is sent to a model.
 *
 * Semantic typography roles (the Typography Engine assigns a role per beat; the
 * STYLE decides how that role looks — size/weight/tracking/leading/case).
 */
export type TypeRole =
  | "hero" | "display" | "headline" | "section" | "body"
  | "caption" | "statistic" | "cta" | "brand" | "footer" | "micro";

/** Layout archetypes (the Layout Engine picks one per beat; the STYLE maps
 * treatments → archetypes and sets the anchor policy). */
export type LayoutArchetype =
  | "centered" | "single-word-hero" | "dual-word-hero" | "stacked"
  | "number" | "side" | "offset" | "split" | "editorial" | "cinematic" | "quote";

/** Narrative treatments (from Beat Analysis) that styles map over. */
export type TreatmentId =
  | "hook" | "stat" | "turn" | "question" | "cta" | "statement";

/** How a semantic role LOOKS in this style (all sizes as fraction of frame H). */
export interface RoleTypeSpec {
  /** Font height as a fraction of PlayResY (e.g. 0.055 = 5.5%H). */
  sizePct: number;
  /** 400 regular · 500 medium · 600 semibold · 700 bold · 800 · 900 heavy. */
  weight: 400 | 500 | 600 | 700 | 800 | 900;
  /** Letter-spacing as a fraction of font size (+ looser, − tighter). Optical. */
  trackingPct: number;
  /** Line height multiplier. */
  leadingMult: number;
  case: "sentence" | "upper" | "title";
}

/** Per-beat motion signature (Motion Engine). Same shape the compiler already
 * understands (scale-in %, overshoot, timings); now owned by the style. */
export interface MotionSpec {
  supportPop: number; keyPop: number; overshoot: number;
  wordFadeMs: number; staggerMs: number; easeAccel: number;
  hold?: boolean; fadeInMs?: number;
}

/** A complete presentation language as data. */
export interface StyleFamily {
  id: string;          // "luxury.apple"
  group: string;       // "Luxury"
  label: string;       // "Apple"
  /** Bundled font family names (must exist in assets/fonts + fontsdir). */
  fonts: { display: string; body: string; mono: string };
  /** How each semantic role looks in this style. */
  type: Record<TypeRole, RoleTypeSpec>;
  /** Typography Engine: treatment → semantic role. */
  roleByTreatment: Record<TreatmentId, TypeRole>;
  /** Layout Engine: treatment → archetype (Layout Engine may still override for
   * word-count, e.g. a 1-word beat → single-word-hero). */
  layoutByTreatment: Record<TreatmentId, LayoutArchetype>;
  /** Motion Engine: treatment → signature. */
  motionByTreatment: Record<TreatmentId, MotionSpec>;
  /** Emphasis Engine. maxTier gates which words may be highlighted (1 number …
   * 5 power-verb … 8 longest); colour = how the focal word reads. */
  emphasis: { maxTier: number; colour: "accent" | "none" | "active-fill" };
  /** Reading Rhythm. */
  rhythm: { maxWordsPerLine: number; holdEvery: number };
  /** Colour behaviour. primary = active/spoken, secondary = inactive/unsung. */
  colour: { primary: string; secondary: string; accentSource: "brand" | "fixed"; accentFixed?: string };
  /** Stroke/shadow/glow (libass). */
  fx: { outlinePx: number; shadowPx: number; blur: number };
}
