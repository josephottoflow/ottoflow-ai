/**
 * DECORATION primitives — drawn vector elements via ASS `\p` drawing mode (bars,
 * dividers, underlines, metric cards). These turn text into COMPOSITION (Design doc
 * 09 §B4) using libass' vector layer — no images, no renderer change. Emitted by the
 * compiler as their OWN Dialogue events (a drawn shape on a layer under the text).
 */
import { drawOn } from "./reveal";

/** A filled axis-aligned rectangle drawing (ASS \p path), origin at the \pos anchor
 * with \an7 (top-left). Compose as: {\an7\pos(x,y)\1c<col>\p1}<rect>{\p0}. */
export function rect(widthPx: number, heightPx: number): string {
  const w = Math.round(widthPx), h = Math.round(heightPx);
  return `m 0 0 l ${w} 0 ${w} ${h} 0 ${h}`;
}

/** Full override + drawing for an accent UNDERLINE bar centred under a line.
 * `cx,y` = bar centre-top; `w,h` = size; `colorAss` = &Hbbggrr& (no alpha).
 * Returns the event body (after the leading `,,0,0,0,,`). The compiler can wrap a
 * `reveal.drawOn` clip around it for the L→R "commit" wipe. */
export function underlineBar(cx: number, y: number, w: number, h: number, colorAss: string, fadeMs = 120): string {
  const x = Math.round(cx - w / 2);
  return `{\\an7\\pos(${x},${Math.round(y)})\\1c${colorAss}\\bord0\\shad0\\fad(${fadeMs},${fadeMs})\\p1}${rect(w, h)}{\\p0}`;
}

/** A thin accent LINE that DRAWS ON (L→R mask wipe) — the "minimal line motion
 * graphics" accent, composed from the decoration + reveal primitives. Returns a
 * full Dialogue event body (after `,,0,0,0,,`). Positioned by its centre `cx` and
 * top `y`; `t` times the draw-on. A geometric element that reads as designed. */
export function accentLine(
  cx: number, y: number, w: number, h: number, colorAss: string,
  t: { offMs: number; durMs: number; accel: number },
): string {
  const ww = Math.round(w), hh = Math.round(Math.max(2, h));
  const x = Math.round(cx - ww / 2), yy = Math.round(y);
  const box = { x1: x, y1: yy, x2: x + ww, y2: yy + hh };
  return `{\\an7\\pos(${x},${yy})\\1c${colorAss}\\bord0\\shad0\\fad(120,160)${drawOn(t, box)}\\p1}${rect(ww, hh)}{\\p0}`;
}

/** A soft metric CARD backing for a statistic (rounded look approximated with a
 * plain rect + low alpha). `\an7\pos` top-left. Returns event body. */
export function cardBacking(x: number, y: number, w: number, h: number, colorAss: string, alphaHex = "&HC0&"): string {
  return `{\\an7\\pos(${Math.round(x)},${Math.round(y)})\\1c${colorAss}\\1a${alphaHex}\\bord0\\shad0\\p1}${rect(w, h)}{\\p0}`;
}
