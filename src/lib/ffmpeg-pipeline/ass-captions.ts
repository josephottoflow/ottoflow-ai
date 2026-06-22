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

function buildHeader(style?: CaptionStyle): string {
  const font = style?.font || "DejaVu Sans";
  const regSize = Math.round((style?.sizePct ?? 72 / PLAY_RES_Y) * PLAY_RES_Y);
  const punchSize = Math.round(regSize * 1.33);
  const primary = assColor(style?.color);
  const back = assBack(style?.boxOpacity ?? 0.5);
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Punch,${font},${punchSize},${primary},&H000000FF,&H00000000,${back},1,0,0,0,100,100,0,0,1,6,4,5,80,80,260,1
Style: Regular,${font},${regSize},${primary},&H000000FF,&H00000000,${back},1,0,0,0,100,100,0,0,1,4,3,5,80,80,260,1

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
export function renderAss(captions: TimedCaption[], style?: CaptionStyle): string {
  const events = captions
    .map((c) => {
      const lines = c.lineBreaks.length > 0 ? c.lineBreaks : [c.text];
      const text = lines.map((l) => escapeAssText(applyCase(l, style?.case))).join(" \\N ");
      const styleName = lines.length > 1 ? "Regular" : "Punch";
      return `Dialogue: 0,${fmt(c.startMs)},${fmt(c.endMs)},${styleName},,0,0,0,,{\\fad(150,150)}${text}`;
    })
    .join("\n");
  return buildHeader(style) + events + "\n";
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
