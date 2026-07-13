/**
 * ASS subtitle file generator (Advanced SubStation Alpha).
 *
 * Why ASS instead of FFmpeg `drawtext`:
 *   - Proper word wrap honoured by libass (drawtext can't wrap).
 *   - Per-event fade in/out via `\fad(150,150)`.
 *   - Bold outline + drop shadow are native styling, not 6 stacked filters.
 *   - One filter (`ass=…`) replaces N drawtext nodes — orders of magnitude
 *     less filter-graph state to debug.
 *
 * The output is a string ready to write to disk and reference via
 *   ...,ass=/tmp/.../captions.ass
 * in the FFmpeg filter chain.
 */
import type { TimedCaption } from "./types";

// ─── Style header ──────────────────────────────────────────────────────────
// Numbers are ASS conventions:
//   - PlayResX/PlayResY: virtual canvas the script renders against. Match
//     output video so coordinates feel native (1080x1920 vertical).
//   - Alignment 2 = bottom-center; 5 = middle-center; 8 = top-center.
//   - Style fields: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour,
//     OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX,
//     ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment,
//     MarginL, MarginR, MarginV, Encoding.
//   - BorderStyle=1 = outline + shadow; =3 = opaque box.
// All colours are &HAABBGGRR — alpha-first, BGR not RGB.

/** Visual World V1 caption typography. Omitted fields fall back to the proven
 * defaults below, so the rendered ASS is byte-identical to the pre-V1 header. */
export interface CaptionStyle {
  font?: string;
  /** Caption (Regular) height as a fraction of PlayResY (1920). Punch = 1.33×. */
  sizePct?: number;
  /** Hex text colour, e.g. "#FFFFFF". */
  color?: string;
  /** Box/shadow opacity 0..1. */
  boxOpacity?: number;
  case?: "sentence" | "upper" | "title";
}

const PLAY_RES_Y = 1920;

/** "#RRGGBB" → ASS "&H00BBGGRR" (alpha-first, BGR). Falls back to white. */
function assColor(hex?: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex ?? "");
  if (!m) return "&H00FFFFFF";
  const rr = m[1].slice(0, 2), gg = m[1].slice(2, 4), bb = m[1].slice(4, 6);
  return `&H00${bb}${gg}${rr}`.toUpperCase();
}

/** Box/shadow BackColour from opacity. ASS alpha: 00 opaque … FF transparent. */
function assBack(opacity: number): string {
  const a = Math.max(0, Math.min(255, Math.round((1 - opacity) * 255)));
  return `&H${a.toString(16).padStart(2, "0").toUpperCase()}000000`;
}

function buildHeader(style: CaptionStyle | undefined, width: number, height: number): string {
  const font = style?.font || "DejaVu Sans";
  // Font size + vertical margin scale with the ACTUAL frame height so captions
  // are proportionally sized/placed on any aspect (Video V1.1). The certified
  // 9:16 (height 1920) is byte-identical: 72/1920×1920=72, 260×1920/1920=260.
  const regSize = Math.round((style?.sizePct ?? 72 / PLAY_RES_Y) * height);
  const punchSize = Math.round(regSize * 1.33);
  const primary = assColor(style?.color);
  const back = assBack(style?.boxOpacity ?? 0.5);
  const marginV = Math.round((260 / PLAY_RES_Y) * height);
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Punch,${font},${punchSize},${primary},&H000000FF,&H00000000,${back},1,0,0,0,100,100,0,0,1,6,4,5,80,80,${marginV},1
Style: Regular,${font},${regSize},${primary},&H000000FF,&H00000000,${back},1,0,0,0,100,100,0,0,1,4,3,5,80,80,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

function applyCase(text: string, c?: CaptionStyle["case"]): string {
  if (c === "upper") return text.toUpperCase();
  if (c === "title") return text.replace(/\b\w/g, (ch) => ch.toUpperCase());
  return text;
}

/**
 * Format milliseconds as ASS time: H:MM:SS.cc (centisecond precision).
 */
function fmt(ms: number): string {
  const totalCs = Math.round(ms / 10);
  const cs = totalCs % 100;
  const totalS = (totalCs - cs) / 100;
  const s = totalS % 60;
  const totalM = (totalS - s) / 60;
  const m = totalM % 60;
  const h = (totalM - m) / 60;
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
}

/**
 * Build the ASS file body for the given captions.
 *
 * Each caption renders for [startMs, endMs] with:
 *   - 150ms fade in + 150ms fade out (`\fad(150,150)`)
 *   - Pre-baked line breaks (caption.lineBreaks) joined with `\N`
 *   - "Punch" style on the FIRST line (bigger), "Regular" on subsequent
 *
 * We split into one event per caption — keeps the parser fast and lets
 * libass cache layout state per event.
 */
export function renderAss(
  captions: TimedCaption[],
  style?: CaptionStyle,
  dims?: { width: number; height: number },
): string {
  // Sprint B — Caption Engine V1. Animated captions are opt-in and fully
  // isolated behind CAPTION_ENGINE=animated (+ CAPTION_STYLE). When unset or
  // "static" the byte-identical Legacy generator below runs unchanged. Any error
  // in the animated path degrades to Legacy here — a caption effect can never
  // break a render. Rollback is a single flag: CAPTION_ENGINE=static.
  if (resolveCaptionEngine() === "animated") {
    try {
      return renderAnimatedAss(captions, dims, ANIMATED_PRESETS[resolveCaptionStyle()]);
    } catch {
      /* fall through to the Legacy static generator */
    }
  }
  const width = dims?.width ?? 1080;
  const height = dims?.height ?? 1920;
  const events = captions
    .map((c) => {
      const lines = c.lineBreaks.length > 0 ? c.lineBreaks : [c.text];
      const text = lines.map((l) => escapeAssText(applyCase(l, style?.case))).join(" \\N ");
      const styleName = lines.length > 1 ? "Regular" : "Punch";
      return `Dialogue: 0,${fmt(c.startMs)},${fmt(c.endMs)},${styleName},,0,0,0,,{\\fad(150,150)}${text}`;
    })
    .join("\n");
  return buildHeader(style, width, height) + events + "\n";
}

/**
 * ASS escapes:
 *   - `{` and `}` are override-block delimiters → escape both.
 *   - `\` literal must double up.
 *   - Real newlines are forbidden in event text; we already split into
 *     lineBreaks above.
 */
function escapeAssText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/[\r\n]+/g, " ");
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint B — Caption Engine V1: animated ASS/libass captions (OPT-IN).
//
// Isolated behind CAPTION_ENGINE=animated; preset via CAPTION_STYLE. Extends the
// SAME ASS/libass path (no renderer change). Uses ONLY the caption's own
// [startMs,endMs] for deterministic per-word "reading-pace" karaoke timing — NO
// Whisper, NO ElevenLabs timestamps, NO speech alignment, NO new dependency.
// Fonts: the already-bundled "DejaVu Sans" (no new font files → no availability
// risk). Position: Alignment 5 (middle-center) + the Legacy MarginV, so captions
// sit in the SAME safe zone as today (clear of the TikTok bottom/side UI rails).
// Readability: capped at 2 lines. When CAPTION_ENGINE≠animated none of this runs.
// ═══════════════════════════════════════════════════════════════════════════

/** The four core presets shipped in V1. */
export type CoreCaptionPreset = "classic" | "bold_creator" | "minimal" | "corporate";

interface AnimatedPreset {
  /** Bundled font only (no availability risk). */
  font: string;
  /** Font height as a fraction of PlayResY (1920). */
  sizePct: number;
  bold: 0 | 1;
  /** Karaoke "sung"/active colour "#RRGGBB". */
  primary: string;
  /** Karaoke "unsung"/inactive colour — kept readable for accessibility. */
  secondary: string;
  outlinePx: number;
  shadowPx: number;
  /** 0 = no background box. */
  boxOpacity: number;
  /** \blur amount (0 = none). Soft glow for the punchy preset. */
  blur: number;
  fadeInMs: number;
  fadeOutMs: number;
  /** Entrance scale start-% (100 = no pop). */
  popFromPct: number;
  popMs: number;
  /** Emit per-word \k karaoke (false = clean fade only). */
  karaoke: boolean;
  case: CaptionStyle["case"];
  /** Letter spacing (px) — a touch improves premium legibility on busy footage.
   * Optional; omitted = 0 (unchanged). */
  spacing?: number;
}

const ANIMATED_PRESETS: Record<CoreCaptionPreset, AnimatedPreset> = {
  // Neutral, close to Legacy: white active, dim-grey unsung, gentle pop + karaoke.
  // V2: slightly stronger stroke/shadow for readability on busy Seedance footage + a touch of spacing.
  classic:      { font: "DejaVu Sans", sizePct: 74 / PLAY_RES_Y, bold: 1, primary: "#FFFFFF", secondary: "#B0B0B0", outlinePx: 5, shadowPx: 3, boxOpacity: 0, blur: 0, fadeInMs: 150, fadeOutMs: 150, popFromPct: 108, popMs: 160, karaoke: true,  case: "sentence", spacing: 0.5 },
  // Punchy creator ("Hormozi") look: UPPERCASE, large, bold, yellow active word, thick stroke + subtle glow + pronounced pop.
  // V2: thicker stroke + heavier shadow for max legibility, tighter fades, letter spacing for punch.
  bold_creator: { font: "DejaVu Sans", sizePct: 100 / PLAY_RES_Y, bold: 1, primary: "#FFD400", secondary: "#FFFFFF", outlinePx: 7, shadowPx: 5, boxOpacity: 0, blur: 1, fadeInMs: 70,  fadeOutMs: 90,  popFromPct: 120, popMs: 190, karaoke: true,  case: "upper", spacing: 1.5 },
  // Restrained: smaller, no bold, thin stroke, clean fade only (no karaoke, no pop). Kept deliberately clean.
  minimal:      { font: "DejaVu Sans", sizePct: 64 / PLAY_RES_Y, bold: 0, primary: "#FFFFFF", secondary: "#FFFFFF", outlinePx: 2, shadowPx: 1, boxOpacity: 0, blur: 0, fadeInMs: 220, fadeOutMs: 200, popFromPct: 100, popMs: 0,   karaoke: false, case: "sentence", spacing: 0 },
  // Polished/professional: sentence case, bold, white active from a cool-grey unsung, moderate stroke, subtle pop.
  // V2: a bit larger + stronger stroke for premium commercial feel.
  corporate:    { font: "DejaVu Sans", sizePct: 76 / PLAY_RES_Y, bold: 1, primary: "#FFFFFF", secondary: "#9FB6C4", outlinePx: 4, shadowPx: 3, boxOpacity: 0, blur: 0, fadeInMs: 180, fadeOutMs: 160, popFromPct: 105, popMs: 180, karaoke: true,  case: "sentence", spacing: 0.5 },
};

/** CAPTION_ENGINE flag → "static" (Legacy default) | "animated". */
function resolveCaptionEngine(): "static" | "animated" {
  return (process.env.CAPTION_ENGINE ?? "").trim().toLowerCase() === "animated" ? "animated" : "static";
}

/** CAPTION_STYLE flag → a core preset. Unknown/unset → "classic". Accepts
 * spacing/hyphen variants ("Bold Creator", "bold-creator" → "bold_creator"). */
function resolveCaptionStyle(): CoreCaptionPreset {
  const s = (process.env.CAPTION_STYLE ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (["classic", "bold_creator", "minimal", "corporate"] as const).includes(s as CoreCaptionPreset)
    ? (s as CoreCaptionPreset)
    : "classic";
}

/**
 * Deterministic per-word karaoke durations (centiseconds) spanning
 * [startMs, endMs]. Weighted by word length (longer words linger). The sum
 * equals the event duration (last word absorbs rounding) so the fill completes
 * exactly at endMs. Derived ONLY from the caption's own timing — no ASR.
 */
function karaokeRuns(words: string[], startMs: number, endMs: number): number[] {
  if (words.length === 0) return [];
  const totalCs = Math.max(words.length, Math.round((endMs - startMs) / 10));
  const weights = words.map((w) => Math.max(1, w.length));
  const wSum = weights.reduce((a, b) => a + b, 0);
  let used = 0;
  return words.map((_, i) => {
    if (i === words.length - 1) return Math.max(1, totalCs - used);
    const cs = Math.max(1, Math.round((totalCs * weights[i]) / wSum));
    used += cs;
    return cs;
  });
}

function buildAnimatedHeader(p: AnimatedPreset, width: number, height: number): string {
  const size = Math.round(p.sizePct * height);
  const marginV = Math.round((260 / PLAY_RES_Y) * height);
  const primary = assColor(p.primary);
  const secondary = assColor(p.secondary);
  const back = assBack(p.boxOpacity);
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${p.font},${size},${primary},${secondary},&H00000000,${back},${p.bold},0,0,0,100,100,${p.spacing ?? 0},0,1,${p.outlinePx},${p.shadowPx},5,120,120,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

/**
 * Animated ASS body. One Dialogue event per caption spanning [startMs, endMs]:
 *   - entrance: \fad + optional scale-pop (\t \fscx/\fscy) + optional \blur glow
 *   - per-word karaoke fill (\k) using deterministic reading-pace timing, or a
 *     clean fade (Minimal). Colours come from the preset (Sprint B does NOT read
 *     brand colours — brand-aware styling is a later sprint).
 * Capped at 2 lines; libass auto-layout + Alignment 5 keep it in the safe zone.
 */
export function renderAnimatedAss(
  captions: TimedCaption[],
  dims?: { width: number; height: number },
  preset: AnimatedPreset = ANIMATED_PRESETS.classic,
): string {
  const width = dims?.width ?? 1080;
  const height = dims?.height ?? 1920;
  const events = captions
    .map((c) => {
      // ≤ 2 lines for readability + safe zone; fold any extras into line 2.
      const raw = c.lineBreaks.length > 0 ? c.lineBreaks : [c.text];
      const lines = raw.length <= 2 ? raw : [raw[0], raw.slice(1).join(" ")];
      const cased = lines.map((l) => applyCase(l, preset.case));

      const entrance =
        `\\fad(${preset.fadeInMs},${preset.fadeOutMs})` +
        (preset.popMs > 0 && preset.popFromPct !== 100
          ? `\\fscx${preset.popFromPct}\\fscy${preset.popFromPct}\\t(0,${preset.popMs},\\fscx100\\fscy100)`
          : "") +
        (preset.blur > 0 ? `\\blur${preset.blur}` : "");

      let text: string;
      if (preset.karaoke) {
        const perLineWords = cased.map((l) => l.split(/\s+/).filter(Boolean));
        const flat = perLineWords.flat();
        const runs = karaokeRuns(flat, c.startMs, c.endMs);
        let k = 0;
        text = perLineWords
          .map((lw) => lw.map((w) => `{\\k${runs[k++]}}${escapeAssText(w)}`).join(" "))
          .join(" \\N ");
      } else {
        text = cased.map((l) => escapeAssText(l)).join(" \\N ");
      }
      return `Dialogue: 0,${fmt(c.startMs)},${fmt(c.endMs)},Caption,,0,0,0,,{${entrance}}${text}`;
    })
    .join("\n");
  return buildAnimatedHeader(preset, width, height) + events + "\n";
}
