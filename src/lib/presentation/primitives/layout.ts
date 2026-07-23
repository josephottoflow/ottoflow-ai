/**
 * LAYOUT (composition) primitives — WHERE a beat sits. Pure functions that resolve
 * an archetype into an absolute Placement (\an + \pos). This is the Composition
 * Engine's core: it replaces "everything dead-centre (\an5 + MarginV)" — the #1
 * subtitle tell (Design doc 09 §B3, roadmap #1) — with deliberate placement.
 *
 * Horizontal safety: centred/hero/number stay on the vertical axis (never clip a
 * side); offset variants inset by the side safe-margin. Vertical rhythm varies by
 * archetype so text isn't nailed to one subtitle line. All values deterministic.
 */
import type { Frame, Placement } from "./types";

export type Archetype =
  | "centered" | "single-word-hero" | "dual-word-hero" | "stacked"
  | "number" | "lower-third" | "offset-left" | "offset-right" | "split";

const SIDE = 0.11; // 11% side safe-margin (≈120px @1080)

/**
 * Resolve placement for one LINE of a beat. `lineIndex`/`lineCount` let stacked/
 * split archetypes position lines independently (the compiler emits them as
 * separate events). `gapPx` is the type's line height (for multi-line offsets).
 */
export function place(
  archetype: Archetype,
  lineIndex: number,
  lineCount: number,
  frame: Frame,
  gapPx = 0,
): Placement {
  const W = frame.width, H = frame.height;
  const cx = Math.round(W / 2);
  const midOffset = (lineIndex - (lineCount - 1) / 2) * gapPx; // center the stack

  switch (archetype) {
    case "single-word-hero":
      // One giant word, commanding the upper-middle.
      return { an: 5, x: cx, y: Math.round(H * 0.46) };
    case "dual-word-hero":
      return { an: 5, x: cx, y: Math.round(H * 0.48 + midOffset) };
    case "number":
      return { an: 5, x: cx, y: Math.round(H * 0.50 + midOffset) };
    case "stacked":
      // Kicker (line 0) sits just above the headline (line 1); tight vertical rhythm.
      return { an: 5, x: cx, y: Math.round(H * 0.50 + midOffset) };
    case "lower-third":
      return { an: 5, x: cx, y: Math.round(H * 0.80 + midOffset) };
    case "offset-left":
      return { an: 4, x: Math.round(W * SIDE), y: Math.round(H * 0.52 + midOffset) };
    case "offset-right":
      return { an: 6, x: Math.round(W * (1 - SIDE)), y: Math.round(H * 0.52 + midOffset) };
    case "split":
      // Two halves stacked with a gap (before/after, contrast).
      return { an: 5, x: cx, y: Math.round(H * (lineIndex === 0 ? 0.44 : 0.58)) };
    case "centered":
    default:
      return { an: 5, x: cx, y: Math.round(H * 0.58 + midOffset) };
  }
}

/** Emit the ASS positioning fragment for a Placement (no braces). */
export function posTag(p: Placement): string {
  return `\\an${p.an}\\pos(${p.x},${p.y})`;
}

/**
 * Kinetic RISE-into-place — the line \move's up from `fromDy` px below its
 * placement over [0,durMs] then holds. A designed slide-up reveal (a Motion-Engine
 * entrance) instead of appearing statically. \move is linear (libass can't ease
 * position); pair with a fade so the linearity reads as intentional. \move and
 * \pos are mutually exclusive — this REPLACES posTag when a rise is wanted.
 */
export function moveIn(p: Placement, fromDy: number, durMs: number): string {
  return `\\an${p.an}\\move(${p.x},${p.y + fromDy},${p.x},${p.y},0,${Math.round(durMs)})`;
}

/** SLIDE-IN — enter from a direction into the placement (kinetic/broadcast). */
export function slideIn(p: Placement, dir: "left" | "right" | "up" | "down", distPx: number, durMs: number): string {
  const d = Math.round(distPx);
  const x1 = p.x + (dir === "left" ? -d : dir === "right" ? d : 0);
  const y1 = p.y + (dir === "up" ? -d : dir === "down" ? d : 0);
  return `\\an${p.an}\\move(${x1},${y1},${p.x},${p.y},0,${Math.round(durMs)})`;
}

/** Estimate a line's on-screen width (px) for mask-wipe boxes / centering.
 * Conservative average advance ≈ 0.56em (matches the rest of the engine). */
export function lineWidthPx(text: string, fontPx: number, trackingPx = 0): number {
  return Math.ceil(text.length * (fontPx * 0.56 + Math.max(0, trackingPx)));
}

/** Bounding box for a centred (an5) line at placement `p`, for maskWipe/decoration. */
export function lineBox(p: Placement, widthPx: number, fontPx: number): { x1: number; y1: number; x2: number; y2: number } {
  const halfW = Math.round(widthPx / 2);
  const halfH = Math.round(fontPx * 0.62);
  return { x1: p.x - halfW, y1: p.y - halfH, x2: p.x + halfW, y2: p.y + halfH };
}
