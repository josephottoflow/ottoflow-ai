/**
 * REVEAL primitives — how a word/element enters. Pure functions returning ASS
 * override fragments (no braces). Composed by the compiler; selected by styles.
 *
 * These are the motion-graphics entrance vocabulary (Design doc 09 §B1), all
 * libass-native: scale-pop + overshoot (spring), blur-in (rack focus), fade-rise,
 * and the signature MASK WIPE (animated \clip). Timing is ms relative to line start.
 */
import type { RevealTiming } from "./types";

const acc = (a: number) => (a && a !== 1 ? `${a},` : "");

/**
 * Scale-pop with OVERSHOOT + settle — the "designed spring". Two \t segments:
 * dip → past target → relax to target. `from`/`to`/`overshoot` are scale-%.
 */
export function scalePop(t: RevealTiming, from: number, to: number, overshoot = 0, settleMs = 90): string {
  const over = to + overshoot;
  return (
    `\\fscx${from}\\fscy${from}` +
    `\\t(${t.offMs},${t.offMs + t.durMs},${acc(t.accel)}\\fscx${over}\\fscy${over})` +
    `\\t(${t.offMs + t.durMs},${t.offMs + t.durMs + settleMs},\\fscx${to}\\fscy${to})`
  );
}

/** Blur-in (rack focus) — resolves from `fromBlur`→`toBlur` as it enters. */
export function blurIn(t: RevealTiming, fromBlur: number, toBlur = 0): string {
  return `\\blur${fromBlur}\\t(${t.offMs},${t.offMs + t.durMs},${acc(t.accel)}\\blur${toBlur})`;
}

/** Fade the element in over [offMs, offMs+durMs] via alpha (line already faded by
 * \fad if used; this is for per-word alpha choreography). */
export function fadeIn(t: RevealTiming): string {
  return `\\alpha&HFF&\\t(${t.offMs},${t.offMs + t.durMs},\\alpha&H00&)`;
}

/**
 * MASK WIPE — the signature motion-graphics reveal: text is revealed behind an
 * animated rectangular `\clip` whose leading edge sweeps across the element's
 * box. Requires the element's absolute bounding box (from the Layout primitive).
 * dir "lr" reveals left→right, "up" bottom→top. libass animates rect \clip only.
 */
export function maskWipe(
  t: RevealTiming,
  box: { x1: number; y1: number; x2: number; y2: number },
  dir: "lr" | "up" = "lr",
): string {
  const { x1, y1, x2, y2 } = box;
  const start = dir === "lr" ? `\\clip(${x1},${y1},${x1},${y2})` : `\\clip(${x1},${y2},${x2},${y2})`;
  const end = `\\clip(${x1},${y1},${x2},${y2})`;
  return `${start}\\t(${t.offMs},${t.offMs + t.durMs},${acc(t.accel)}${end})`;
}

/** Draw-on wipe for a DECORATION bar/line already positioned at [x1..x2] — same
 * animated clip, exposed separately as the "commit" gesture (underlines, dividers). */
export function drawOn(t: RevealTiming, box: { x1: number; y1: number; x2: number; y2: number }): string {
  return maskWipe(t, box, "lr");
}
