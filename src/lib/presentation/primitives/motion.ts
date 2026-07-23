/**
 * MOTION primitives — CONTINUOUS life during the HOLD (after the entrance, while the
 * beat sits on screen). Distinct from reveal.ts (entrances): these animate across a
 * [startMs,endMs] window of the whole event so text never feels frozen (Design doc
 * 06 — "intentional stillness vs. subtle life"). Pure functions, ASS override
 * fragments (no braces), composed by the compiler and selected by a style's recipe.
 *
 * libass constraint: `\t` animates scale/rotation/spacing/blur/colour/alpha — but NOT
 * `\pos`/`\org`. Continuous *translation* is therefore impossible mid-event (position
 * only moves via a one-shot `\move`, which is an ENTRANCE, see layout.moveIn/slideIn).
 * So "float/drift" here is expressed as scale / micro-rotation, not x/y motion.
 */

/** A time window (ms, relative to line start) that a continuous motion spans. */
export interface MotionWindow {
  startMs: number;
  endMs: number;
}

const acc = (a?: number) => (a && a !== 1 ? `${a},` : "");

/**
 * DRIFT — a slow, near-imperceptible push-in/out over the hold ("Ken Burns for
 * text"). Keeps a static beat alive. `fromPct`→`toPct` scale-% across the window
 * (e.g. 100→103 = gentle push-in). Set an initial scale so the drift is continuous
 * from the entrance's resting 100%.
 */
export function drift(w: MotionWindow, fromPct = 100, toPct = 103, accel = 1): string {
  return `\\fscx${fromPct}\\fscy${fromPct}\\t(${w.startMs},${w.endMs},${acc(accel)}\\fscx${toPct}\\fscy${toPct})`;
}

/**
 * HOLD — intentional STILLNESS. The absence of motion is a deliberate choice (calm/
 * luxury rhythm); emitting nothing lets the beat rest. Exposed as a named primitive so
 * a recipe can *declare* stillness rather than imply it by omission.
 */
export function hold(): string {
  return "";
}

/**
 * PUNCH — a fast scale accent bump then settle at `atMs` (an emphasis pulse / "hit").
 * Aggressive-timing philosophies use this to detonate a key word mid-hold. `amp` is
 * the overshoot in scale-% above 100.
 */
export function punch(atMs: number, durMs = 140, amp = 12): string {
  const up = Math.round(durMs * 0.4);
  return (
    `\\t(${atMs},${atMs + up},\\fscx${100 + amp}\\fscy${100 + amp})` +
    `\\t(${atMs + up},${atMs + durMs},\\fscx100\\fscy100)`
  );
}

/**
 * BREATHE — a slow symmetric scale oscillation (up then back) across the window: the
 * subtlest possible "alive" cue for a long-held beat. `amp` scale-% (keep ≤ 2 for
 * premium restraint). Two mirrored `\t` segments centred on the window.
 */
export function breathe(w: MotionWindow, amp = 2): string {
  const mid = Math.round((w.startMs + w.endMs) / 2);
  const s = 100 + amp;
  return `\\t(${w.startMs},${mid},\\fscx${s}\\fscy${s})\\t(${mid},${w.endMs},\\fscx100\\fscy100)`;
}

/**
 * SETTLE-ROTATE — a micro `\frz` relaxation to level over the window (from a tiny
 * tilt to 0°). Editorial/handmade feel; keep `fromDeg` ≤ 2 to stay tasteful.
 */
export function settleRotate(w: MotionWindow, fromDeg = 1.5, toDeg = 0, accel = 0.7): string {
  return `\\frz${fromDeg}\\t(${w.startMs},${w.endMs},${acc(accel)}\\frz${toDeg})`;
}

/**
 * BLUR-PULSE — a brief focus dip-and-recover at `atMs` (a soft attention "throb" on a
 * key word). Resolves back to sharp. `amp` = peak `\blur`.
 */
export function blurPulse(atMs: number, durMs = 200, amp = 4): string {
  const mid = Math.round(atMs + durMs * 0.4);
  return `\\t(${atMs},${mid},\\blur${amp})\\t(${mid},${atMs + durMs},\\blur0)`;
}

/**
 * SWAY — a slow `\frz` oscillation (tilt one way, back through level, and settle):
 * a gentle pendulum for playful/broadcast holds. `amp` degrees (≤ 2 tasteful).
 */
export function sway(w: MotionWindow, amp = 1.5): string {
  const third = Math.round((w.endMs - w.startMs) / 3);
  const a = w.startMs;
  return (
    `\\frz${amp}` +
    `\\t(${a},${a + third},\\frz${-amp})` +
    `\\t(${a + third},${a + 2 * third},\\frz${amp})` +
    `\\t(${a + 2 * third},${w.endMs},\\frz0)`
  );
}
