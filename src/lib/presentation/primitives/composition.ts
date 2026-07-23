/**
 * COMPOSITION library — WHERE ATTENTION LIVES. The highest-leverage layer of the
 * Presentation Engine: a composition arranges a whole beat in the frame (every line's
 * position, alignment and relative emphasis, plus the decoration anchors that frame it).
 * Reveal/motion/transition decide WHEN things move; composition decides the STRUCTURE the
 * eye reads — the difference between "designed motion graphics" and "centered subtitles".
 *
 * Contract: pure, deterministic. A composition is a named function `(CompContext) =>
 * Composed`; philosophies reference it BY NAME via the registry (no switch statements in
 * the compiler — it looks the name up and lays the beat out from the returned structure).
 * Geometry is authored for a 1080×1920 vertical frame but derived from `frame` so it
 * scales. Nothing here emits ASS or animates — it returns a layout the compiler serializes.
 */
import type { Frame, Placement } from "./types";

export type CompositionId =
  | "single-hero" | "dual-hero" | "triple-hero" | "editorial-stack"
  | "magazine-cover" | "statistic-card" | "quote-card" | "offset-left"
  | "offset-right" | "lower-third" | "sidebar" | "corner-label"
  | "dynamic-grid" | "floating-caption" | "center-focus" | "poster"
  | "split" | "timeline" | "feature-callout" | "comparison";

/** Semantic role a slot plays (drives which type-spec + emphasis the compiler applies). */
export type SlotRole =
  | "hero" | "kicker" | "support" | "stat" | "unit" | "cta"
  | "quote" | "attribution" | "label" | "step";

/** One positioned text line within a composition. */
export interface CompSlot {
  /** Index into the beat's grouped lines this slot renders. */
  line: number;
  placement: Placement;
  /** Relative size multiplier vs. the composition's base role (1 = base). */
  emphasis: number;
  align: "l" | "c" | "r";
  role: SlotRole;
}

/** A decoration element a composition asks the compiler to draw (via decoration.ts).
 * Anchor contract: `accentLine`/`divider`/`underline`/`leader`/`tick`/`dot` use (x,y) =
 * the element's CENTRE; `card`/`sidebarBar` use (x,y) = TOP-LEFT; `cornerBracket` uses
 * (x,y) = the outer CORNER point. `w`,`h` are always the element's size. */
export interface CompDecorAnchor {
  kind:
    | "accentLine" | "card" | "sidebarBar" | "cornerBracket"
    | "divider" | "underline" | "tick" | "dot" | "leader";
  x: number; y: number; w: number; h: number;
  corner?: "tl" | "tr" | "bl" | "br";
}

/** The resolved arrangement of a beat. */
export interface Composed {
  id: CompositionId;
  slots: CompSlot[];
  decor: CompDecorAnchor[];
  /** Which slot carries the primary attention (keyword/focal). */
  focusSlot: number;
}

/** What a composition needs to resolve geometry. */
export interface CompContext {
  frame: Frame;
  /** Number of grouped lines in the beat (compositions adapt to 1..N). */
  lineCount: number;
  /** Base font px for the primary role, for decoration/card sizing. */
  fontPx: number;
  /** Estimated on-screen width per line (px), for cards/underlines. Optional. */
  lineWidthsPx?: number[];
  /** Line index holding the keyword (default: last line). */
  keywordLine?: number;
}

// ── geometry helpers ────────────────────────────────────────────────────────
const SIDE = 0.11;   // side safe-margin fraction (≈119px @1080)
const TOP = 0.12;    // top safe fraction
const BOT = 0.14;    // bottom safe fraction (captions/handles live low on phones)

const r = Math.round;
function widthOf(ctx: CompContext, line: number, fallbackChars = 10): number {
  const est = ctx.lineWidthsPx?.[line];
  if (est && est > 0) return est;
  return r(fallbackChars * ctx.fontPx * 0.56);
}
function keyword(ctx: CompContext): number {
  return ctx.keywordLine ?? Math.max(0, ctx.lineCount - 1);
}
/** Evenly-spaced vertical band [top,bottom] fractions → y px for `i` of `n`. */
function bandY(frame: Frame, topFrac: number, botFrac: number, i: number, n: number): number {
  if (n <= 1) return r(frame.height * (topFrac + botFrac) / 2);
  const t = frame.height * topFrac, b = frame.height * botFrac;
  return r(t + (b - t) * (i / (n - 1)));
}

// ── the compositions ─────────────────────────────────────────────────────────

/** SINGLE HERO — one commanding line, upper-middle; nothing competes. */
function singleHero(ctx: CompContext): Composed {
  const { frame } = ctx, cx = r(frame.width / 2), y = r(frame.height * 0.44);
  const w = widthOf(ctx, 0);
  return {
    id: "single-hero",
    slots: [{ line: 0, placement: { an: 5, x: cx, y }, emphasis: 1, align: "c", role: "hero" }],
    decor: [{ kind: "accentLine", x: cx, y: r(y + ctx.fontPx * 0.72), w: r(Math.min(w * 0.5, frame.width * 0.34)), h: Math.max(3, r(ctx.fontPx * 0.05)) }],
    focusSlot: 0,
  };
}

/** DUAL HERO — a small kicker over a big hero line (two-beat vertical rhythm). */
function dualHero(ctx: CompContext): Composed {
  const { frame } = ctx, cx = r(frame.width / 2);
  const y0 = r(frame.height * 0.42), y1 = r(frame.height * 0.52);
  return {
    id: "dual-hero",
    slots: [
      { line: 0, placement: { an: 5, x: cx, y: y0 }, emphasis: 0.6, align: "c", role: "kicker" },
      { line: Math.min(1, ctx.lineCount - 1), placement: { an: 5, x: cx, y: y1 }, emphasis: 1, align: "c", role: "hero" },
    ],
    decor: [{ kind: "accentLine", x: cx, y: r((y0 + y1) / 2), w: r(frame.width * 0.14), h: Math.max(3, r(ctx.fontPx * 0.045)) }],
    focusSlot: 1,
  };
}

/** TRIPLE HERO — three stacked lines, the middle emphasised (classic title stack). */
function tripleHero(ctx: CompContext): Composed {
  const { frame } = ctx, cx = r(frame.width / 2);
  const ys = [0.40, 0.50, 0.60].map((f) => r(frame.height * f));
  const n = Math.min(3, ctx.lineCount);
  const slots: CompSlot[] = [];
  for (let i = 0; i < n; i++) {
    slots.push({ line: i, placement: { an: 5, x: cx, y: ys[i] }, emphasis: i === 1 ? 1 : 0.66, align: "c", role: i === 1 ? "hero" : "support" });
  }
  return { id: "triple-hero", slots, decor: [], focusSlot: Math.min(1, n - 1) };
}

/** EDITORIAL STACK — left-aligned kicker → headline → support, tight leading (magazine). */
function editorialStack(ctx: CompContext): Composed {
  const { frame } = ctx, x = r(frame.width * SIDE);
  const n = Math.min(3, ctx.lineCount);
  const gap = r(ctx.fontPx * 1.18);
  const startY = r(frame.height * 0.44 - ((n - 1) * gap) / 2);
  const roles: SlotRole[] = ["kicker", "hero", "support"];
  const emph = [0.5, 1, 0.62];
  const slots: CompSlot[] = [];
  for (let i = 0; i < n; i++) {
    slots.push({ line: i, placement: { an: 4, x, y: startY + i * gap }, emphasis: emph[i] ?? 0.62, align: "l", role: roles[i] ?? "support" });
  }
  return {
    id: "editorial-stack",
    slots,
    decor: [{ kind: "accentLine", x: r(x + frame.width * 0.06), y: r(startY - ctx.fontPx * 0.7), w: r(frame.width * 0.10), h: Math.max(3, r(ctx.fontPx * 0.05)), corner: "tl" }],
    focusSlot: Math.min(1, n - 1),
  };
}

/** MAGAZINE COVER — grand centered headline in the upper third, kicker rule above,
 * small footer below, corner brackets framing the whole (editorial cover energy). */
function magazineCover(ctx: CompContext): Composed {
  const { frame } = ctx, cx = r(frame.width / 2);
  const n = Math.min(3, ctx.lineCount);
  const gap = r(ctx.fontPx * 1.14);
  const startY = r(frame.height * 0.34);
  const slots: CompSlot[] = [];
  for (let i = 0; i < n; i++) {
    slots.push({ line: i, placement: { an: 5, x: cx, y: startY + i * gap }, emphasis: i === 0 ? 1 : 0.9, align: "c", role: i === 0 ? "hero" : "support" });
  }
  const m = r(frame.width * SIDE), t = r(frame.height * TOP), b = r(frame.height * (1 - BOT));
  const bl = r(frame.width * 0.12);
  return {
    id: "magazine-cover",
    slots,
    decor: [
      { kind: "divider", x: cx, y: r(startY - ctx.fontPx * 0.9), w: r(frame.width * 0.30), h: 3 },
      { kind: "cornerBracket", x: m, y: t, w: bl, h: bl, corner: "tl" },
      { kind: "cornerBracket", x: r(frame.width - m), y: t, w: bl, h: bl, corner: "tr" },
      { kind: "cornerBracket", x: m, y: b, w: bl, h: bl, corner: "bl" },
      { kind: "cornerBracket", x: r(frame.width - m), y: b, w: bl, h: bl, corner: "br" },
    ],
    focusSlot: 0,
  };
}

/** STATISTIC CARD — the figure DOMINATES, a small label above and unit/context below,
 * seated on a soft card backing (data reads as a designed metric moment). */
function statisticCard(ctx: CompContext): Composed {
  const { frame } = ctx, cx = r(frame.width / 2), cy = r(frame.height * 0.5);
  const hasLabel = ctx.lineCount >= 2;
  const statLine = hasLabel ? 1 : 0;
  const slots: CompSlot[] = [];
  // The FIGURE commands — a stat card exists to make the number hit hard, so the stat slot
  // is much larger than the label/unit (strong hierarchy). Emphasis is relative to the
  // statistic role size; the number-bearing line is usually short so it won't overflow.
  if (hasLabel) slots.push({ line: 0, placement: { an: 5, x: cx, y: r(cy - ctx.fontPx * 1.62) }, emphasis: 0.36, align: "c", role: "label" });
  slots.push({ line: statLine, placement: { an: 5, x: cx, y: cy }, emphasis: 1.42, align: "c", role: "stat" });
  if (ctx.lineCount >= 3) slots.push({ line: 2, placement: { an: 5, x: cx, y: r(cy + ctx.fontPx * 1.62) }, emphasis: 0.4, align: "c", role: "unit" });
  const cardW = r(Math.min(frame.width * 0.74, Math.max(widthOf(ctx, statLine, 6) * 2.0, frame.width * 0.52)));
  const cardH = r(ctx.fontPx * 3.9);
  return {
    id: "statistic-card",
    slots,
    decor: [{ kind: "card", x: r(cx - cardW / 2), y: r(cy - cardH / 2), w: cardW, h: cardH }],
    focusSlot: hasLabel ? 1 : 0,
  };
}

/** QUOTE CARD — centered quote with an oversized quote mark and an attribution below. */
function quoteCard(ctx: CompContext): Composed {
  const { frame } = ctx, cx = r(frame.width / 2);
  const quoteN = Math.max(1, ctx.lineCount - 1);
  const gap = r(ctx.fontPx * 1.18);
  const startY = r(frame.height * 0.46 - ((quoteN - 1) * gap) / 2);
  const slots: CompSlot[] = [];
  for (let i = 0; i < quoteN; i++) {
    slots.push({ line: i, placement: { an: 5, x: cx, y: startY + i * gap }, emphasis: 1, align: "c", role: "quote" });
  }
  if (ctx.lineCount >= 2) {
    slots.push({ line: ctx.lineCount - 1, placement: { an: 5, x: cx, y: r(startY + quoteN * gap + ctx.fontPx * 0.6) }, emphasis: 0.5, align: "c", role: "attribution" });
  }
  return {
    id: "quote-card",
    slots,
    decor: [
      { kind: "accentLine", x: cx, y: r(startY - ctx.fontPx * 0.9), w: r(frame.width * 0.08), h: Math.max(3, r(ctx.fontPx * 0.05)) },
      { kind: "divider", x: cx, y: r(startY + quoteN * gap + ctx.fontPx * 0.1), w: r(frame.width * 0.16), h: 2 },
    ],
    focusSlot: 0,
  };
}

/** OFFSET LEFT / RIGHT — the block hugs one side with a vertical accent bar (asymmetry
 * is the composition; kills the centered-subtitle tell). */
function offset(side: "left" | "right"): (ctx: CompContext) => Composed {
  return (ctx: CompContext): Composed => {
    const { frame } = ctx;
    const left = side === "left";
    const x = left ? r(frame.width * SIDE) : r(frame.width * (1 - SIDE));
    const an = left ? 4 : 6;
    const n = Math.min(3, ctx.lineCount);
    const gap = r(ctx.fontPx * 1.16);
    const startY = r(frame.height * 0.5 - ((n - 1) * gap) / 2);
    const slots: CompSlot[] = [];
    for (let i = 0; i < n; i++) {
      slots.push({ line: i, placement: { an, x, y: startY + i * gap }, emphasis: i === keyword(ctx) ? 1 : 0.66, align: left ? "l" : "r", role: i === keyword(ctx) ? "hero" : "support" });
    }
    const barX = left ? r(frame.width * SIDE - ctx.fontPx * 0.5) : r(frame.width * (1 - SIDE) + ctx.fontPx * 0.5);
    return {
      id: left ? "offset-left" : "offset-right",
      slots,
      decor: [{ kind: "sidebarBar", x: barX, y: r(startY - ctx.fontPx * 0.6), w: Math.max(4, r(ctx.fontPx * 0.08)), h: r((n - 1) * gap + ctx.fontPx * 1.2) }],
      focusSlot: Math.min(keyword(ctx), n - 1),
    };
  };
}

/** BROADCAST LOWER THIRD — title + subtitle anchored low-left on a bar (news/sports). */
function lowerThird(ctx: CompContext): Composed {
  const { frame } = ctx, x = r(frame.width * SIDE);
  const yTitle = r(frame.height * 0.78);
  const gap = r(ctx.fontPx * 1.05);
  const slots: CompSlot[] = [{ line: 0, placement: { an: 4, x, y: yTitle }, emphasis: 1, align: "l", role: "hero" }];
  if (ctx.lineCount >= 2) slots.push({ line: 1, placement: { an: 4, x, y: r(yTitle + gap) }, emphasis: 0.52, align: "l", role: "support" });
  return {
    id: "lower-third",
    slots,
    decor: [
      { kind: "tick", x: r(x - ctx.fontPx * 0.55), y: r(yTitle - ctx.fontPx * 0.55), w: Math.max(5, r(ctx.fontPx * 0.1)), h: r(ctx.fontPx * (ctx.lineCount >= 2 ? 1.7 : 0.95)) },
      { kind: "underline", x: r(x + frame.width * 0.14), y: r(yTitle + ctx.fontPx * (ctx.lineCount >= 2 ? 1.55 : 0.7)), w: r(frame.width * 0.30), h: 3 },
    ],
    focusSlot: 0,
  };
}

/** SIDEBAR — a full-height accent rail on the left with a small top label, main text
 * centred in the remaining space (structured editorial). */
function sidebar(ctx: CompContext): Composed {
  const { frame } = ctx;
  const railX = r(frame.width * 0.16);
  const cx = r(railX + (frame.width - railX) / 2);
  const n = Math.min(3, ctx.lineCount);
  const gap = r(ctx.fontPx * 1.16);
  const startY = r(frame.height * 0.5 - ((n - 1) * gap) / 2);
  const slots: CompSlot[] = [];
  for (let i = 0; i < n; i++) {
    slots.push({ line: i, placement: { an: 5, x: cx, y: startY + i * gap }, emphasis: i === keyword(ctx) ? 1 : 0.66, align: "c", role: i === keyword(ctx) ? "hero" : "support" });
  }
  return {
    id: "sidebar",
    slots,
    decor: [{ kind: "sidebarBar", x: railX, y: r(frame.height * TOP), w: Math.max(4, r(ctx.fontPx * 0.09)), h: r(frame.height * (1 - TOP - BOT)) }],
    focusSlot: Math.min(keyword(ctx), n - 1),
  };
}

/** CORNER LABEL — a small index/label pinned to a corner + a centred hero (title-card). */
function cornerLabel(ctx: CompContext): Composed {
  const { frame } = ctx, cx = r(frame.width / 2), cy = r(frame.height * 0.5);
  const m = r(frame.width * SIDE), t = r(frame.height * TOP);
  const heroLine = ctx.lineCount >= 2 ? 1 : 0;
  const slots: CompSlot[] = [];
  if (ctx.lineCount >= 2) slots.push({ line: 0, placement: { an: 7, x: m, y: t }, emphasis: 0.42, align: "l", role: "label" });
  slots.push({ line: heroLine, placement: { an: 5, x: cx, y: cy }, emphasis: 1, align: "c", role: "hero" });
  return {
    id: "corner-label",
    slots,
    decor: [{ kind: "cornerBracket", x: m, y: t, w: r(frame.width * 0.09), h: r(frame.width * 0.09), corner: "tl" }],
    focusSlot: slots.length - 1,
  };
}

/** DYNAMIC GRID — lines placed at loose grid nodes (energetic, editorial). Up to 4. */
function dynamicGrid(ctx: CompContext): Composed {
  const { frame } = ctx;
  const n = Math.min(4, ctx.lineCount);
  const cols = n <= 2 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  const slots: CompSlot[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const x = cols === 1 ? r(frame.width / 2) : r(frame.width * (col === 0 ? 0.34 : 0.66));
    const y = bandY(frame, 0.36, 0.64, row, rows);
    slots.push({ line: i, placement: { an: 5, x, y }, emphasis: i === keyword(ctx) ? 1.15 : 0.7, align: "c", role: i === keyword(ctx) ? "hero" : "support" });
  }
  return { id: "dynamic-grid", slots, decor: [], focusSlot: Math.min(keyword(ctx), n - 1) };
}

/** FLOATING CAPTION — placed off-centre in lower-left negative space, small bullet dot
 * (reads as a designed caption floating over footage, not a subtitle bar). */
function floatingCaption(ctx: CompContext): Composed {
  const { frame } = ctx, x = r(frame.width * 0.14);
  const n = Math.min(2, ctx.lineCount);
  const gap = r(ctx.fontPx * 1.14);
  const startY = r(frame.height * 0.64);
  const slots: CompSlot[] = [];
  for (let i = 0; i < n; i++) {
    slots.push({ line: i, placement: { an: 4, x: r(x + ctx.fontPx * 0.8), y: startY + i * gap }, emphasis: i === 0 ? 1 : 0.6, align: "l", role: i === 0 ? "hero" : "support" });
  }
  return {
    id: "floating-caption",
    slots,
    decor: [{ kind: "dot", x, y: r(startY - ctx.fontPx * 0.1), w: Math.max(8, r(ctx.fontPx * 0.16)), h: Math.max(8, r(ctx.fontPx * 0.16)) }],
    focusSlot: 0,
  };
}

/** CENTER FOCUS — a refined centred stack: the focal line enlarges, neighbours recede
 * (the honest, restrained default — center done deliberately, not by accident). */
function centerFocus(ctx: CompContext): Composed {
  const { frame } = ctx, cx = r(frame.width / 2);
  const n = Math.min(3, ctx.lineCount);
  const kw = Math.min(keyword(ctx), n - 1);
  const gap = r(ctx.fontPx * 1.16);
  const startY = r(frame.height * 0.5 - ((n - 1) * gap) / 2);
  const slots: CompSlot[] = [];
  for (let i = 0; i < n; i++) {
    slots.push({ line: i, placement: { an: 5, x: cx, y: startY + i * gap }, emphasis: i === kw ? 1 : 0.7, align: "c", role: i === kw ? "hero" : "support" });
  }
  return { id: "center-focus", slots, decor: [], focusSlot: kw };
}

/** POSTER — oversized headline top-aligned + a baseline label, full-width rule (drama). */
function poster(ctx: CompContext): Composed {
  const { frame } = ctx, cx = r(frame.width / 2);
  const n = Math.min(3, ctx.lineCount);
  const gap = r(ctx.fontPx * 1.08);
  const startY = r(frame.height * 0.28);
  const slots: CompSlot[] = [];
  for (let i = 0; i < n; i++) {
    slots.push({ line: i, placement: { an: 5, x: cx, y: startY + i * gap }, emphasis: 1.1, align: "c", role: i === 0 ? "hero" : "support" });
  }
  const ry = r(frame.height * 0.82);
  return {
    id: "poster",
    slots,
    decor: [{ kind: "divider", x: cx, y: ry, w: r(frame.width * (1 - 2 * SIDE)), h: 3 }],
    focusSlot: 0,
  };
}

/** SPLIT — before/after divided by a rule. The two states sit CLOSE to the divider (a
 * tight, paired comparison, not two floating lines) with before→after hierarchy: the
 * "before" recedes above, the resolved "after" leads below. */
function split(ctx: CompContext): Composed {
  const { frame } = ctx, cx = r(frame.width / 2), midY = r(frame.height * 0.5);
  const slots: CompSlot[] = [{ line: 0, placement: { an: 5, x: cx, y: r(frame.height * 0.44) }, emphasis: 0.78, align: "c", role: "support" }];
  if (ctx.lineCount >= 2) slots.push({ line: 1, placement: { an: 5, x: cx, y: r(frame.height * 0.56) }, emphasis: 1, align: "c", role: "hero" });
  return {
    id: "split",
    slots,
    decor: [{ kind: "divider", x: cx, y: midY, w: r(frame.width * 0.52), h: 3 }],
    focusSlot: slots.length - 1,
  };
}

/** TIMELINE — steps along a horizontal baseline with a connecting rule + dots (process). */
function timeline(ctx: CompContext): Composed {
  const { frame } = ctx, y = r(frame.height * 0.5);
  const n = Math.min(3, ctx.lineCount);
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(n === 1 ? r(frame.width / 2) : r(frame.width * (SIDE + (1 - 2 * SIDE) * (i / (n - 1)))));
  const slots: CompSlot[] = xs.map((x, i) => ({
    line: i, placement: { an: 5, x, y: r(y - ctx.fontPx * 0.9) }, emphasis: i === keyword(ctx) ? 1.05 : 0.66, align: "c", role: "step" as SlotRole,
  }));
  const decor: CompDecorAnchor[] = [{ kind: "leader", x: r((xs[0] + xs[n - 1]) / 2), y: r(y + ctx.fontPx * 0.4), w: xs[n - 1] - xs[0], h: Math.max(2, r(ctx.fontPx * 0.04)) }];
  xs.forEach((x) => decor.push({ kind: "dot", x, y: r(y + ctx.fontPx * 0.42), w: Math.max(8, r(ctx.fontPx * 0.14)), h: Math.max(8, r(ctx.fontPx * 0.14)) }));
  return { id: "timeline", slots, decor, focusSlot: Math.min(keyword(ctx), n - 1) };
}

/** FEATURE CALLOUT — a small label + a big value with a corner bracket + leader (spec). */
function featureCallout(ctx: CompContext): Composed {
  const { frame } = ctx, cx = r(frame.width / 2), cy = r(frame.height * 0.5);
  const valueLine = ctx.lineCount >= 2 ? 1 : 0;
  const slots: CompSlot[] = [];
  if (ctx.lineCount >= 2) slots.push({ line: 0, placement: { an: 4, x: r(frame.width * SIDE), y: r(cy - ctx.fontPx * 1.5) }, emphasis: 0.46, align: "l", role: "label" });
  slots.push({ line: valueLine, placement: { an: 5, x: cx, y: cy }, emphasis: 1.4, align: "c", role: "hero" });
  return {
    id: "feature-callout",
    slots,
    decor: [
      { kind: "cornerBracket", x: r(frame.width * SIDE), y: r(cy - ctx.fontPx * 1.75), w: r(frame.width * 0.07), h: r(frame.width * 0.07), corner: "tl" },
      { kind: "leader", x: r(frame.width * SIDE + frame.width * 0.11), y: r(cy - ctx.fontPx * 1.2), w: r(frame.width * 0.22), h: Math.max(2, r(ctx.fontPx * 0.035)) },
    ],
    focusSlot: slots.length - 1,
  };
}

/** COMPARISON — two labelled columns split by a vertical divider (A vs B). */
function comparison(ctx: CompContext): Composed {
  const { frame } = ctx, cy = r(frame.height * 0.5);
  const lx = r(frame.width * 0.29), rx = r(frame.width * 0.71);
  const slots: CompSlot[] = [{ line: 0, placement: { an: 5, x: lx, y: cy }, emphasis: 1, align: "c", role: "hero" }];
  if (ctx.lineCount >= 2) slots.push({ line: 1, placement: { an: 5, x: rx, y: cy }, emphasis: 1, align: "c", role: "hero" });
  return {
    id: "comparison",
    slots,
    decor: [{ kind: "divider", x: r(frame.width / 2), y: cy, w: Math.max(2, r(ctx.fontPx * 0.05)), h: r(ctx.fontPx * 2) }],
    focusSlot: 0,
  };
}

/**
 * The composition REGISTRY — philosophies reference a composition by name; the compiler
 * looks it up here. Adding a composition = adding an entry (no compiler switch).
 */
export const COMPOSITIONS: Record<CompositionId, (ctx: CompContext) => Composed> = {
  "single-hero": singleHero,
  "dual-hero": dualHero,
  "triple-hero": tripleHero,
  "editorial-stack": editorialStack,
  "magazine-cover": magazineCover,
  "statistic-card": statisticCard,
  "quote-card": quoteCard,
  "offset-left": offset("left"),
  "offset-right": offset("right"),
  "lower-third": lowerThird,
  "sidebar": sidebar,
  "corner-label": cornerLabel,
  "dynamic-grid": dynamicGrid,
  "floating-caption": floatingCaption,
  "center-focus": centerFocus,
  "poster": poster,
  "split": split,
  "timeline": timeline,
  "feature-callout": featureCallout,
  "comparison": comparison,
};

/** Resolve a composition by id (unknown → center-focus, the safe restrained default). */
export function compose(id: string, ctx: CompContext): Composed {
  const fn = COMPOSITIONS[id as CompositionId] ?? centerFocus;
  return fn(ctx);
}
