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

/**
 * WORD-AS-IMAGE (expressive typography) — a word whose MOTION expresses its MEANING
 * (Research doc 11). Per-word-safe categories only (scale/rotate/shake/stretch/fade);
 * translation categories (fall/rise/split) need single-word placement and are handled
 * by the compiler with `\move`. Returns override tags (no braces); "" for non-express.
 */
export function express(category: string, t: RevealTiming): string {
  const acc2 = acc(t.accel);
  const seg = `${t.offMs},${t.offMs + t.durMs}`;
  switch (category) {
    case "grow":    return `\\fscx45\\fscy45\\t(${seg},${acc2}\\fscx100\\fscy100)`;
    case "shrink":  return `\\fscx175\\fscy175\\t(${seg},${acc2}\\fscx100\\fscy100)`;
    case "stretch": return `\\fscx40\\t(${seg},${acc2}\\fscx100)`;
    case "spin":    return `\\frz-90\\t(${seg},${acc2}\\frz0)`;
    case "shake":   return `\\t(${t.offMs},${t.offMs + 80},\\frz5)\\t(${t.offMs + 80},${t.offMs + 170},\\frz-5)\\t(${t.offMs + 170},${t.offMs + 260},\\frz0)`;
    case "fade":    return `\\alpha&HFF&\\t(${seg},${acc2}\\alpha&H00&)`;
    default:        return "";
  }
}

/**
 * LETTER CASCADE (animated-typeface principle, Research doc 11) — build a word
 * letter-by-letter: each character scales + fades in, staggered by `perCharMs`.
 * Returns the word as per-char override runs (compose into event text). Expensive
 * per char → reserve for hero / single-word beats.
 */
export function letterCascade(word: string, t: RevealTiming, perCharMs: number): string {
  const acc2 = acc(t.accel);
  return word
    .split("")
    .map((ch, i) => {
      const off = t.offMs + i * perCharMs;
      return `{\\fscx55\\fscy55\\alpha&HFF&\\t(${off},${off + t.durMs},${acc2}\\fscx100\\fscy100\\alpha&H00&)}${ch}`;
    })
    .join("");
}

/** TYPEWRITER — reveal characters one by one via alpha (no scale), like typing.
 * Returns the word as per-char alpha-staggered runs. Cheaper than letterCascade. */
export function typewriter(word: string, t: RevealTiming, perCharMs: number): string {
  return word
    .split("")
    .map((ch, i) => {
      const on = t.offMs + i * perCharMs;
      return `{\\alpha&HFF&\\t(${on},${on + 20},\\alpha&H00&)}${ch}`;
    })
    .join("");
}

/** FLIP-IN — 3D rotate the element in on the X (default) or Y axis. Broadcast/News. */
export function flipIn(t: RevealTiming, axis: "x" | "y" = "x", fromDeg = 90): string {
  const tag = axis === "y" ? "fry" : "frx";
  return `\\${tag}${fromDeg}\\t(${t.offMs},${t.offMs + t.durMs},${acc(t.accel)}\\${tag}0)`;
}

/** ELASTIC — a springier settle than a single overshoot: past target, under, rest. */
export function elastic(t: RevealTiming, from: number, to: number, amp = 10): string {
  const q = Math.round(t.durMs / 3);
  const o = t.offMs;
  return (
    `\\fscx${from}\\fscy${from}` +
    `\\t(${o},${o + q},${acc(t.accel)}\\fscx${to + amp}\\fscy${to + amp})` +
    `\\t(${o + q},${o + 2 * q},\\fscx${to - Math.round(amp / 2)}\\fscy${to - Math.round(amp / 2)})` +
    `\\t(${o + 2 * q},${o + t.durMs},\\fscx${to}\\fscy${to})`
  );
}

/** TRACKING EXPAND — letter-spacing opens from tight to target as it enters
 * (luxury/editorial "settle"). `fromFsp`→`toFsp` in px. */
export function trackingExpand(t: RevealTiming, fromFsp: number, toFsp: number): string {
  return `\\fsp${fromFsp}\\t(${t.offMs},${t.offMs + t.durMs},${acc(t.accel)}\\fsp${toFsp})`;
}

/** COMPRESS — the inverse: spacing/scale compress inward to rest (impact snap). */
export function compress(t: RevealTiming, fromFsp: number, toFsp = 0): string {
  return `\\fsp${fromFsp}\\t(${t.offMs},${t.offMs + t.durMs},${acc(t.accel)}\\fsp${toFsp})`;
}
