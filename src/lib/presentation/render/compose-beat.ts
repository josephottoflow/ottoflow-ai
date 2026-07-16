/**
 * COMPOSE-BEAT — the bridge from a philosophy's COMPOSITION (composition.ts) to rendered
 * ASS. Given a resolved `Composed` layout and a beat's grouped lines, it emits one
 * Dialogue event per slot (placed, sized by emphasis, revealed by the philosophy's reveal
 * primitive, with the focal word emphasised by the attention layer) plus one event per
 * decoration anchor. Pure + deterministic; emits ONLY libass-native tags.
 *
 * This is the "pure recipe executor" path: the compiler picks the composition id from the
 * philosophy (`compositionByTreatment`) and calls here — it makes NO design decision. The
 * philosophy owns structure (composition), emphasis (role×emphasis), reveal, exit, colour.
 */
import { compose, type CompDecorAnchor, type CompContext } from "../primitives/composition";
import { posTag } from "../primitives/layout";
import { accentLine, cardBacking, cornerBracket, dot, divider, rect } from "../primitives/decoration";
import { trackingTag } from "../primitives/typography";
import { drift } from "../primitives/motion";

export interface ComposeBeatInput {
  compositionId: string;
  /** Grouped, already-cased line texts of the beat. */
  lines: string[];
  /** Focal word index per line (−1 = none); attention emphasises it on the focus slot. */
  keywordByLine: number[];
  frame: { width: number; height: number };
  startMs: number;
  endMs: number;
  /** Base font px for emphasis = 1 (the hero/primary role size). */
  baseFontPx: number;
  /** Focal accent colour as &Hbbggrr& (no alpha). Empty = no accent (mono premium). */
  accentColorAss: string;
  /** ASS style name to render text with (e.g. "Caption"). */
  styleName: string;
  reveal: string;
  exit: string;
  /** Continuous-hold motion token (e.g. "drift"|"hold"); absent/"hold" = stillness. */
  motion?: string;
  fadeInMs: number;
  fadeOutMs: number;
  /** Estimated on-screen width per line (px) for card/underline sizing. */
  lineWidthsPx?: number[];
}

const rnd = Math.round;
const SIDE_FRAC = 0.11;
/** Overflow guard (Typography Engine): shrink fontPx so `text` fits `maxWidthPx`.
 * Average advance ≈ 0.56em, matching the rest of the engine. Never enlarges. */
function fitFont(text: string, fontPx: number, maxWidthPx: number): number {
  const est = text.length * fontPx * 0.56;
  if (est <= maxWidthPx || maxWidthPx <= 0) return fontPx;
  return Math.max(24, Math.floor(fontPx * (maxWidthPx / est)));
}
/** Available width (px) for a slot, from its alignment/anchor + frame safe margins. */
function slotMaxWidth(an: number, x: number, frameW: number): number {
  const side = frameW * SIDE_FRAC;
  if (an === 4 || an === 7) return frameW - side - x;        // left-anchored → to right margin
  if (an === 6 || an === 9) return x - side;                 // right-anchored → to left margin
  return Math.min(x - side, frameW - side - x) * 2;          // centred → symmetric
}
function fmt(ms: number): string {
  const t = Math.max(0, ms), cs = Math.round((t % 1000) / 10);
  const s = Math.floor(t / 1000) % 60, m = Math.floor(t / 60000) % 60, h = Math.floor(t / 3600000);
  const p = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${h}:${p(m)}:${p(s)}.${p(cs)}`;
}
function esc(s: string): string {
  return s.replace(/[{}\\]/g, "");
}

/** Entrance placement for a slot, per the reveal token, staggered by `offMs`. Position-
 * only reveals (riseFade/blurResolve) rise into place over [offMs, offMs+fadeInMs] via a
 * one-shot \move (replaces \pos); others hold static at the placement. */
function entranceTag(reveal: string, p: { an: number; x: number; y: number }, fontPx: number, fadeInMs: number, offMs: number): string {
  if (reveal === "riseFade" || reveal === "blurResolve") {
    const rise = Math.round(Math.max(24, fontPx * 0.3));
    return `\\an${p.an}\\move(${p.x},${p.y + rise},${p.x},${p.y},${offMs},${offMs + fadeInMs})`;
  }
  return posTag(p);
}

/** Draw one decoration anchor as a full Dialogue event body. */
function decorEvent(d: CompDecorAnchor, accentAss: string, fontPx: number, tStart: number): string {
  const t = { offMs: tStart, durMs: 340, accel: 0.6 };
  switch (d.kind) {
    case "card":
      return cardBacking(d.x, d.y, d.w, d.h, "&H202428&", "&HB4&");
    case "accentLine":
      return accentLine(d.x, rnd(d.y - d.h / 2), d.w, d.h, accentAss, t);
    case "divider":
    case "underline":
    case "leader":
    case "tick": {
      // A drawn bar; horizontal ones draw-on, vertical (h>w) just fade.
      if (d.h > d.w) {
        const x = rnd(d.x - d.w / 2), y = rnd(d.y - d.h / 2);
        return `{\\an7\\pos(${x},${y})\\1c${accentAss}\\bord0\\shad0\\fad(140,160)\\p1}${rect(d.w, d.h)}{\\p0}`;
      }
      return divider(d.x, rnd(d.y - d.h / 2), d.w, d.h, accentAss, t);
    }
    case "sidebarBar": {
      return `{\\an7\\pos(${rnd(d.x)},${rnd(d.y)})\\1c${accentAss}\\bord0\\shad0\\fad(160,180)\\p1}${rect(d.w, d.h)}{\\p0}`;
    }
    case "cornerBracket":
      return cornerBracket(d.x, d.y, Math.max(d.w, d.h), Math.max(5, rnd(fontPx * 0.08)), accentAss, d.corner ?? "tl");
    case "dot":
      return dot(d.x, d.y, Math.max(4, rnd(d.w / 2)), accentAss, 120);
    default:
      return "";
  }
}

/** Render a composed beat → a block of Dialogue lines (\n-joined). */
export function renderComposedBeat(inp: ComposeBeatInput): string {
  const firstKw = inp.keywordByLine.findIndex((k) => k >= 0);
  const ctx: CompContext = {
    frame: inp.frame,
    lineCount: inp.lines.length,
    fontPx: inp.baseFontPx,
    lineWidthsPx: inp.lineWidthsPx,
    keywordLine: firstKw >= 0 ? firstKw : undefined,
  };
  const c = compose(inp.compositionId, ctx);
  // Coverage safety net — a composition may emit fewer slots than the beat has lines
  // (e.g. single-hero + a 2-line beat). NEVER drop content: append any uncovered line as a
  // centred support slot stacked below the composition's lowest slot.
  const covered = new Set(c.slots.map((s) => s.line));
  if (covered.size < inp.lines.length) {
    let maxY = Math.max(inp.frame.height * 0.42, ...c.slots.map((s) => s.placement.y));
    const gap = rnd(inp.baseFontPx * 0.85);
    for (let li = 0; li < inp.lines.length; li++) {
      if (covered.has(li)) continue;
      maxY += gap;
      c.slots.push({ line: li, placement: { an: 5, x: rnd(inp.frame.width / 2), y: rnd(maxY) }, emphasis: 0.66, align: "c", role: "support" });
    }
  }
  const start = fmt(inp.startMs), end = fmt(inp.endMs);
  const focusLine = c.slots[c.focusSlot]?.line ?? -1;
  const events: string[] = [];

  // Decoration first (drawn UNDER the text; earlier events render lower).
  for (const d of c.decor) {
    const body = decorEvent(d, inp.accentColorAss || "&HFFFFFF&", inp.baseFontPx, inp.fadeInMs + 120);
    if (body) events.push(`Dialogue: 0,${start},${end},${inp.styleName},,0,0,0,,${body}`);
  }

  // One event per text slot. Slots enter STAGGERED (presentation rhythm) — a beat that
  // reveals all at once reads mechanical; leading the kicker then the hero reads authored.
  const durMs = Math.max(inp.fadeInMs + 300, inp.endMs - inp.startMs);
  const STAGGER = 90; // ms per slot (calm); the compiler's timing token could scale this
  for (let si = 0; si < c.slots.length; si++) {
    const s = c.slots[si];
    const line = inp.lines[s.line];
    if (line == null) continue;
    const wanted = rnd(inp.baseFontPx * s.emphasis);
    const maxW = slotMaxWidth(s.placement.an, s.placement.x, inp.frame.width);
    const fontPx = fitFont(line, wanted, maxW); // overflow guard — never wrap/collide
    const off = si * STAGGER;
    const ent = entranceTag(inp.reveal, s.placement, fontPx, inp.fadeInMs, off);
    // Optical tracking (Typography Engine) — size-relative letter-spacing per slot.
    const track = trackingTag(fontPx, inp.frame.height);
    // Alpha fade IN at the slot's stagger offset + fade OUT at the beat's end (replaces
    // \fad so the entrance can be offset per slot).
    const fadeOutStart = Math.max(off + inp.fadeInMs + 120, durMs - inp.fadeOutMs);
    const alpha = `\\alpha&HFF&\\t(${off},${off + inp.fadeInMs},\\alpha&H00&)\\t(${rnd(fadeOutStart)},${rnd(durMs)},\\alpha&HFF&)`;
    // POP reveal (Impact) — a scale-in with a slight overshoot; the punchy entrance.
    const isPop = inp.reveal === "pop" || inp.reveal === "scatter";
    const pop = isPop
      ? `\\fscx58\\fscy58\\t(${off},${off + inp.fadeInMs},\\fscx104\\fscy104)\\t(${off + inp.fadeInMs},${off + inp.fadeInMs + 80},\\fscx100\\fscy100)`
      : "";
    // Rack focus (blurResolve) — premium defocus→sharp on the focus slot; only for the
    // calm reveals, never with a pop (a blur would fight a punch).
    const rack = !isPop && (s.line === focusLine || inp.reveal === "blurResolve") ? `\\blur7\\t(${off},${off + inp.fadeInMs},\\blur0)` : "";
    // Continuous-hold motion — near-imperceptible push-in keeps the beat alive (Premium
    // "drift"); "hold"/"punch"/absent = no continuous drift (Impact punches on entry).
    const motionTag = inp.motion === "drift" ? drift({ startMs: off + inp.fadeInMs, endMs: durMs }, 100, 102) : "";
    const head = `{${ent}\\fs${fontPx}${track}${alpha}${pop}${rack}${motionTag}}`;

    // Attention: emphasise the focal word on the focus slot (accent colour), else plain.
    let text: string;
    const kw = inp.keywordByLine[s.line] ?? -1;
    if (s.line === focusLine && kw >= 0 && inp.accentColorAss) {
      // Sparse accent: colour ONLY the explicit focal word (never a whole line — that
      // would read as loud, not premium). Beats with no focal word stay monochrome.
      const words = line.split(/\s+/);
      text = words
        .map((w, i) =>
          i === kw ? `{\\1c${inp.accentColorAss}}${esc(w)}{\\1c&HFFFFFF&}` : esc(w),
        )
        .join(" ");
    } else {
      text = esc(line);
    }
    events.push(`Dialogue: 0,${start},${end},${inp.styleName},,0,0,0,,${head}${text}`);
  }
  return events.join("\n");
}
