/**
 * OttoFlow Creative OS — Layout Engine (Phase 4).
 *
 * A pure, deterministic composition resolver: frame → platform safe geometry, with
 * helpers to test/clamp a placed box into the safe field and to enforce the
 * density ceiling. This is the token-driven realization of the safe-area concern
 * the production `safeAreaValidationPass` was stubbed for — sourced from ONE
 * canonical set (tokens/layout.ts) so registers can tune composition later.
 *
 * Coordinate space matches the production layout primitives
 * (presentation/primitives/layout.ts): PlayRes px, top-left origin, y increasing
 * downward. Output is metadata that drops onto `beat.layout` without any compiler
 * change; consumed only via the opt-in pass + Render Profile mechanism.
 *
 * Purity: no clock, no I/O, no globals.
 */
import { SAFE_ZONES, LAYOUT_DENSITY, LAYER_ORDER, type Aspect, type Layer } from "../tokens/layout";

export interface Frame {
  width: number;
  height: number;
}
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const RATIO: Record<Aspect, number> = { "9:16": 9 / 16, "1:1": 1, "16:9": 16 / 9 };

/** Classify a frame to the nearest supported aspect by width/height ratio. */
export function resolveAspect(frame: Frame): Aspect {
  const r = frame.width / frame.height;
  let best: Aspect = "9:16";
  let bestD = Infinity;
  for (const a of Object.keys(RATIO) as Aspect[]) {
    const d = Math.abs(RATIO[a] - r);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

/** Resolve the platform safe-zone insets (px) for a frame. */
export function resolveSafeInsets(frame: Frame, aspect: Aspect = resolveAspect(frame)): Insets {
  const z = SAFE_ZONES[aspect];
  return {
    top: Math.round(z.topPct * frame.height),
    bottom: Math.round(z.bottomPct * frame.height),
    left: Math.round(z.leftPct * frame.width),
    right: Math.round(z.rightPct * frame.width),
  };
}

/** The inner safe rectangle (px) — where meaning may live, clear of platform UI. */
export function safeBox(frame: Frame, aspect: Aspect = resolveAspect(frame)): Box {
  const i = resolveSafeInsets(frame, aspect);
  return { x1: i.left, y1: i.top, x2: frame.width - i.right, y2: frame.height - i.bottom };
}

/** True when `box` sits entirely inside the safe field. */
export function isWithinSafeArea(box: Box, frame: Frame, aspect: Aspect = resolveAspect(frame)): boolean {
  const s = safeBox(frame, aspect);
  return box.x1 >= s.x1 && box.y1 >= s.y1 && box.x2 <= s.x2 && box.y2 <= s.y2;
}

/** Shift `[a,b]` to fit within `[lo,hi]`; if it is longer than the range, pin it. */
function clamp1D(a: number, b: number, lo: number, hi: number): [number, number] {
  if (a < lo) { b += lo - a; a = lo; }
  if (b > hi) { a -= b - hi; b = hi; }
  if (a < lo) a = lo; // longer than the range → pin both edges
  if (b > hi) b = hi;
  return [a, b];
}

/** Clamp a box into the safe field — shift it inside when possible, else pin its
 * edges to the safe bounds. The result always satisfies isWithinSafeArea. */
export function clampToSafeArea(box: Box, frame: Frame, aspect: Aspect = resolveAspect(frame)): Box {
  const s = safeBox(frame, aspect);
  const [x1, x2] = clamp1D(box.x1, box.x2, s.x1, s.x2);
  const [y1, y2] = clamp1D(box.y1, box.y2, s.y1, s.y2);
  return { x1, y1, x2, y2 };
}

/** True when the element count respects the density ceiling (one idea, room to spare). */
export function withinDensity(count: number): boolean {
  return count <= LAYOUT_DENSITY.maxElements;
}

export { LAYER_ORDER };

/** The z-index of a named layer (ground=0 … frame=last). -1 if unknown. */
export function layerIndex(layer: Layer): number {
  return LAYER_ORDER.indexOf(layer);
}
