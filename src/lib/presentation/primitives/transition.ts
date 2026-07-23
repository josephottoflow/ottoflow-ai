/**
 * TRANSITION primitives — how a beat LEAVES, and how two beats hand off (beat→beat
 * continuity). Reveal.ts owns entrances, motion.ts owns the hold; this owns EXITS and
 * the cut. A transition makes successive beats feel authored as one sequence instead of
 * disconnected cards (Design doc 09 §transitions). Pure, ASS override fragments (no
 * braces) timed relative to the OUTGOING line's own start (so `atMs` ≈ its end − durMs).
 *
 * libass constraint (same as motion.ts): `\t` can't animate `\pos`; positional exits use
 * a one-shot `\move` whose [t1,t2] window is the exit. A `\move` REPLACES the line's
 * `\pos`, so an exit-slide primitive returns the full `\an\move` (compose without a
 * separate posTag). Non-positional exits (fade/scale/blur/wipe) compose alongside `\pos`.
 */
import type { Placement } from "./types";

/** EXIT-FADE — alpha out over [atMs, atMs+durMs]. Composes with \pos. */
export function exitFade(atMs: number, durMs = 220): string {
  return `\\t(${Math.round(atMs)},${Math.round(atMs + durMs)},\\alpha&HFF&)`;
}

/** EXIT-SCALE-DOWN — recede (scale to `toPct`) + fade, a soft dismiss. Composes with \pos. */
export function exitScaleDown(atMs: number, durMs = 220, toPct = 88): string {
  const a = Math.round(atMs), b = Math.round(atMs + durMs);
  return `\\t(${a},${b},\\fscx${toPct}\\fscy${toPct}\\alpha&HFF&)`;
}

/** EXIT-BLUR — defocus out (rack-focus away). Composes with \pos. */
export function exitBlur(atMs: number, durMs = 220, amp = 8): string {
  const a = Math.round(atMs), b = Math.round(atMs + durMs);
  return `\\t(${a},${b},\\blur${amp}\\alpha&HFF&)`;
}

/**
 * EXIT-SLIDE — the line slides OUT of frame in `dir` over [atMs, atMs+durMs]. Returns
 * the full `\an\move` (start = placement, end = placement + offscreen offset) and REPLACES
 * `\pos`. `frameW/frameH` size the offscreen distance so it fully clears.
 */
export function exitSlide(
  p: Placement, dir: "left" | "right" | "up" | "down",
  atMs: number, durMs: number, frameW: number, frameH: number,
): string {
  const dx = dir === "left" ? -frameW : dir === "right" ? frameW : 0;
  const dy = dir === "up" ? -frameH : dir === "down" ? frameH : 0;
  return `\\an${p.an}\\move(${p.x},${p.y},${p.x + dx},${p.y + dy},${Math.round(atMs)},${Math.round(atMs + durMs)})`;
}

/**
 * WIPE-OUT — reverse mask: the animated `\clip` COLLAPSES the line's box to nothing
 * over the exit (leading edge sweeps across hiding it). `dir` "lr" hides left→right.
 * Composes with \pos. Mirror of reveal.maskWipe.
 */
export function wipeOut(
  box: { x1: number; y1: number; x2: number; y2: number },
  atMs: number, durMs: number, dir: "lr" | "up" = "lr",
): string {
  const { x1, y1, x2, y2 } = box;
  const full = `\\clip(${x1},${y1},${x2},${y2})`;
  const gone = dir === "lr" ? `\\clip(${x2},${y1},${x2},${y2})` : `\\clip(${x1},${y1},${x2},${y1})`;
  return `${full}\\t(${Math.round(atMs)},${Math.round(atMs + durMs)},${gone})`;
}

/**
 * CROSS-PUSH — a paired handoff: the outgoing beat slides one way while the incoming
 * beat enters from the opposite side (a "pushed by the next card" feel). Returns both
 * fragments; the compiler applies `.out` to the ending event and `.in` to the starting
 * event (each a full `\an\move` that replaces its `\pos`). `p` is shared placement.
 */
export function crossPush(
  p: Placement, dir: "left" | "right" | "up" | "down",
  outAtMs: number, inDurMs: number, frameW: number, frameH: number,
): { out: string; in: string } {
  const dx = dir === "left" ? -frameW : dir === "right" ? frameW : 0;
  const dy = dir === "up" ? -frameH : dir === "down" ? frameH : 0;
  const out = `\\an${p.an}\\move(${p.x},${p.y},${p.x + dx},${p.y + dy},${Math.round(outAtMs)},${Math.round(outAtMs + inDurMs)})`;
  // Incoming enters from the OPPOSITE side into placement over [0,inDurMs].
  const inTag = `\\an${p.an}\\move(${p.x - dx},${p.y - dy},${p.x},${p.y},0,${Math.round(inDurMs)})`;
  return { out, in: inTag };
}
