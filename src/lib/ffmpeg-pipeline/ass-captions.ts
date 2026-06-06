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

const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Punch,DejaVu Sans,96,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,6,4,5,80,80,260,1
Style: Regular,DejaVu Sans,72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,3,5,80,80,260,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

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
export function renderAss(captions: TimedCaption[]): string {
  const events = captions
    .map((c) => {
      const lines = c.lineBreaks.length > 0 ? c.lineBreaks : [c.text];
      const text = lines.map(escapeAssText).join(" \\N ");
      const style = lines.length > 1 ? "Regular" : "Punch";
      return `Dialogue: 0,${fmt(c.startMs)},${fmt(c.endMs)},${style},,0,0,0,,{\\fad(150,150)}${text}`;
    })
    .join("\n");
  return ASS_HEADER + events + "\n";
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
