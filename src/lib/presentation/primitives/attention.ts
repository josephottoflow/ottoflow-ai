/**
 * ATTENTION primitives — direct the EYE within a beat (attention choreography, Design
 * doc 06). Where reveal/motion/transition govern WHEN things move, these govern WHERE
 * the viewer looks: contrast of brightness, weight, size, spacing and focus between the
 * focal word and its support. Pure, ASS override fragments (no braces), applied per-run
 * by the compiler (focal word vs. the rest of the line).
 *
 * Design principle: attention is created by DIFFERENCE, not decoration — the focal word
 * is emphasised by pushing the SUPPORT words down (dim/thin/tighten) as much as by
 * lifting the focal word up. Each primitive returns a fragment for ONE run; the "reset"
 * companion returns what must be restored on the following run so emphasis doesn't leak.
 */

/** Alpha for a dim level in ASS (&Haa& form). 0 = opaque, 255 = invisible. */
function alphaHex(a: number): string {
  const v = Math.max(0, Math.min(255, Math.round(a)));
  return `&H${v.toString(16).padStart(2, "0").toUpperCase()}&`;
}

/**
 * DIM — push a SUPPORT word back by lowering its opacity (the focal word then reads as
 * "lit"). `level` 0..1 = how far dimmed (0.35 ≈ recedes but still legible). Pair with
 * `undim()` on the next focal run. Primary-alpha only (outline/shadow untouched).
 */
export function dim(level = 0.35): string {
  return `\\1a${alphaHex(level * 255)}`;
}

/** Restore full opacity (companion to `dim`). */
export function undim(): string {
  return `\\1a&H00&`;
}

/**
 * FOCUS-POP — the focal word: accent colour + a size lift in one gesture. `colorAss` is
 * &Hbbggrr& (no alpha); `scalePct` the lift (108 ≈ tasteful, 130+ = loud). Companion
 * `focusReset(primaryAss)` restores colour + 100% scale on the next run.
 */
export function focusPop(colorAss: string, scalePct = 110): string {
  return `\\1c${colorAss}\\fscx${scalePct}\\fscy${scalePct}`;
}

/** Restore primary colour + 100% scale (companion to `focusPop`). */
export function focusReset(primaryAss: string): string {
  return `\\1c${primaryAss}\\fscx100\\fscy100`;
}

/**
 * WEIGHT-SHIFT — thin the SUPPORT words (regular) so the focal word's bold reads as
 * hierarchy. Emits `\b0` for support; companion `weightRestore()` returns `\b1`. (Only
 * meaningful when the base style is bold.)
 */
export function weightThin(): string {
  return `\\b0`;
}
export function weightRestore(): string {
  return `\\b1`;
}

/**
 * TIGHTEN — pull SUPPORT letter-spacing in (negative `\fsp`) so the focal word, at
 * default/expanded spacing, owns the optical weight. `px` is the tighten amount.
 * Companion `tightenReset()` returns `\fsp0`.
 */
export function tighten(px = 2): string {
  return `\\fsp${-Math.abs(Math.round(px))}`;
}
export function tightenReset(): string {
  return `\\fsp0`;
}

/**
 * SPOTLIGHT-IN — a focal word that BRIGHTENS into emphasis over [offMs,offMs+durMs]
 * (support stays dim): opacity rises from `fromLevel` to full while the rest holds back.
 * A timed attention pull (the eye is led to the word as it lights up). Returns tags for
 * the focal run only.
 */
export function spotlightIn(offMs: number, durMs = 160, fromLevel = 0.4): string {
  return `\\1a${alphaHex(fromLevel * 255)}\\t(${Math.round(offMs)},${Math.round(offMs + durMs)},\\1a&H00&)`;
}

/**
 * DESATURATE-HOLD — a whole-line "everything recedes except one" cue: support runs get
 * BOTH dim + thin in a single call (the strongest isolation). Companion
 * `isolateReset(primaryAss)` restores colour, opacity, weight, spacing on the focal run.
 */
export function isolateSupport(dimLevel = 0.3): string {
  return `${dim(dimLevel)}${weightThin()}${tighten(2)}`;
}
export function isolateReset(primaryAss: string): string {
  return `${undim()}${weightRestore()}${tightenReset()}\\1c${primaryAss}`;
}
