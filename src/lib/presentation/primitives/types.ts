/**
 * Motion Graphics PRIMITIVES (V5) — the reusable, composable building blocks of
 * the Presentation Engine. Each primitive is a PURE function that emits an ASS
 * override-tag fragment (no braces) for one motion-graphics technique, given
 * explicit parameters. The compiler composes primitives into the final ASS; styles
 * are configuration that select primitives + params. NOTHING is hardcoded in the
 * compiler — techniques live here as primitives (Design doc 09 §D, the primitive
 * architecture the roadmap builds on).
 *
 * Categories (each file): Reveal · Layout · Decoration · (later) Composition /
 * Choreography / Transition / CTA / Ending. All emit standard ASS tags rendered by
 * our existing `ass=` (libass) filter — NO renderer change.
 *
 * Contract: pure, deterministic, side-effect-free; return a string of override tags
 * WITHOUT the enclosing `{}` so fragments compose. Never throw for control flow.
 */

export interface Frame {
  width: number;
  height: number;
}

/** Timing shared by entrance primitives (ms, relative to line start). */
export interface RevealTiming {
  /** Stagger offset for this word/element. */
  offMs: number;
  /** Entrance duration. */
  durMs: number;
  /** \t acceleration (<1 ease-out, 1 linear, >1 ease-in). */
  accel: number;
}

/** A resolved placement (Layout primitive output). */
export interface Placement {
  /** ASS alignment (numpad 1–9). */
  an: number;
  /** Absolute x,y in frame px for \pos. */
  x: number;
  y: number;
}

/** Primitive provenance tag (for the knowledge base / QA), attached in metadata. */
export type PrimitiveKind =
  | "reveal" | "layout" | "decoration" | "composition"
  | "choreography" | "transition" | "cta" | "ending";
