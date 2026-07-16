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
import { FONT } from "./typography";
import { runPresentationEngine } from "../presentation";
import { applyStyle } from "../presentation/styles/core";
import { getStyleFamily } from "../presentation/styles/registry";
import { place, posTag, moveIn, lineWidthPx, type Archetype } from "../presentation/primitives/layout";
import { accentLine } from "../presentation/primitives/decoration";
import { renderComposedBeat } from "../presentation/render/compose-beat";

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
/** Inline colour-override form `&HBBGGRR&` (no alpha) for \1c/\3c tags. */
function assColorTag(hex: string): string {
  return `&H${assColor(hex).slice(4)}&`;
}

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
  /** Per-render presentation flags (Video Quality V2/V3). Resolved from the job's
   * renderProfile by the composer and passed EXPLICITLY per render — this is the
   * only activation path (no global env default). Absent → Legacy static.
   * accentColor (V3) = brand-palette accent for keyword emphasis (never hardcoded;
   * the composer supplies marigold only as a fallback). */
  profile?: {
    captionEngine?: "static" | "animated";
    /** A core preset name ("corporate"/"bold_creator"/…) OR any registered philosophy id
     * ("premium"/"impact"/"editorial"/"broadcast"/…) — the latter derives a smart preset
     * from the philosophy so all 12 are selectable without a new preset each. */
    captionStyle?: CoreCaptionPreset | string;
    accentColor?: string | null;
  },
): string {
  // Sprint B — Caption Engine V1. Animated captions are opt-in and fully
  // isolated behind CAPTION_ENGINE=animated (+ CAPTION_STYLE). When unset or
  // "static" the byte-identical Legacy generator below runs unchanged. Any error
  // in the animated path degrades to Legacy here — a caption effect can never
  // break a render. Rollback is a single flag: CAPTION_ENGINE=static.
  if (resolveCaptionEngine(profile?.captionEngine) === "animated") {
    try {
      // A philosophy id (premium/impact/editorial/…) derives a smart preset from its
      // StyleFamily; otherwise fall back to the 4 core caption presets.
      const philosophyPreset = presetForPhilosophy(profile?.captionStyle);
      return renderAnimatedAss(
        captions,
        dims,
        philosophyPreset ?? ANIMATED_PRESETS[resolveCaptionStyle(profile?.captionStyle as CoreCaptionPreset)],
        profile?.accentColor ?? undefined,
      );
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
  /** Active-word emphasis: true = smooth left→right fill (\kf, polished);
   * false/omitted = instant per-word highlight (\k, punchy). Timing identical. */
  karaokeFill?: boolean;
  /** V3 Phase 2 — Caption Intelligence. true = deterministic 1–3 word chunking
   * (Style Guide §3) + one emphasised keyword per line. false/omitted = the V2
   * behaviour (byte-identical: uses the caption's own lineBreaks, no emphasis). */
  smartGroup?: boolean;
  /** Max words per line when smartGroup is on (default 3). */
  maxWordsPerLine?: number;
  /** Keyword scale-% for the emphasised word when smartGroup is on (default 108). */
  keywordScalePct?: number;
  /** Max emphasis tier eligible for a keyword highlight (Caption Design V2). Lower
   * = more restrained/premium (only true payload words get colour; ordinary lines
   * stay clean white). 5 = number..power-verb (premium); 6 = +contrast (creator).
   * Omitted → 8 (every line highlighted; V4-P4 behaviour). */
  emphasisMaxTier?: number;
  /** V4 Phase 4 — per-word staggered reveal (ms between words). When set (smart
   * presets), words fade in one-by-one instead of the whole caption at once — the
   * premium "designed" reveal. Omitted → V3 whole-caption entrance (unchanged). */
  staggerMs?: number;
  /** Per-word fade-in duration for the stagger (ms, default 140). */
  wordFadeMs?: number;
  /** \t acceleration for the scale-pop: <1 = ease-out (premium), 1 = linear.
   * Omitted → linear (V3, unchanged). */
  easeAccel?: number;
  /** V5 — Motion Typography style-family id. When set, the Presentation Core
   * (applyStyle) decides per-beat typography/layout/motion and the compiler
   * serializes that IR (semantic roles, real hierarchy) instead of the preset
   * constants. Omitted → the preset drives everything (V4 behaviour). */
  styleId?: string;
}

const ANIMATED_PRESETS: Record<CoreCaptionPreset, AnimatedPreset> = {
  // Neutral, close to Legacy: white active, dim-grey unsung, gentle pop + karaoke.
  // V2: slightly stronger stroke/shadow for readability on busy Seedance footage + a touch of spacing.
  classic:      { font: "DejaVu Sans", sizePct: 74 / PLAY_RES_Y, bold: 1, primary: "#FFFFFF", secondary: "#B0B0B0", outlinePx: 5, shadowPx: 3, boxOpacity: 0, blur: 0, fadeInMs: 150, fadeOutMs: 150, popFromPct: 108, popMs: 160, karaoke: true,  case: "sentence", spacing: 0.5, karaokeFill: true },
  // Punchy creator ("Hormozi") look: UPPERCASE, large, bold, yellow active word, thick stroke + subtle glow + pronounced pop.
  // V2: thicker stroke + heavier shadow for max legibility, tighter fades, letter spacing for punch.
  bold_creator: { font: FONT.SORA, sizePct: 100 / PLAY_RES_Y, bold: 1, primary: "#FFD400", secondary: "#FFFFFF", outlinePx: 7, shadowPx: 5, boxOpacity: 0, blur: 1, fadeInMs: 70,  fadeOutMs: 90,  popFromPct: 120, popMs: 190, karaoke: true,  case: "upper", spacing: 1.5, smartGroup: true, maxWordsPerLine: 3, keywordScalePct: 126, staggerMs: 40, wordFadeMs: 120, easeAccel: 0.5, emphasisMaxTier: 6, styleId: "impact" },
  // Restrained: smaller, no bold, thin stroke, clean fade only (no karaoke, no pop). Kept deliberately clean.
  minimal:      { font: "DejaVu Sans", sizePct: 64 / PLAY_RES_Y, bold: 0, primary: "#FFFFFF", secondary: "#FFFFFF", outlinePx: 2, shadowPx: 1, boxOpacity: 0, blur: 0, fadeInMs: 220, fadeOutMs: 200, popFromPct: 100, popMs: 0,   karaoke: false, case: "sentence", spacing: 0 },
  // Polished/professional: sentence case, bold, white active from a cool-grey unsung, moderate stroke, subtle pop.
  // V2: a bit larger + stronger stroke for premium commercial feel.
  corporate:    { font: FONT.JAKARTA, sizePct: 104 / PLAY_RES_Y, bold: 1, primary: "#FFFFFF", secondary: "#9FB6C4", outlinePx: 5, shadowPx: 3, boxOpacity: 0, blur: 0, fadeInMs: 180, fadeOutMs: 160, popFromPct: 105, popMs: 180, karaoke: true,  case: "sentence", spacing: 0.5, karaokeFill: true, smartGroup: true, maxWordsPerLine: 3, keywordScalePct: 118, staggerMs: 45, wordFadeMs: 150, easeAccel: 0.5, emphasisMaxTier: 5, styleId: "premium" },
};

/**
 * Derive a smart AnimatedPreset from a registered PHILOSOPHY id (premium/impact/editorial/
 * broadcast/documentary/signature/minimal/cinematic/precision/momentum/pulse/custom). This
 * is what makes all 12 philosophies selectable WITHOUT authoring a preset each — the
 * philosophy's StyleFamily supplies fonts/colours/sizes/case and the composition path owns
 * the rest. Returns null for non-philosophy names (caller uses the core presets). */
function presetForPhilosophy(id?: string): AnimatedPreset | null {
  const fam = getStyleFamily(id);
  if (!fam) return null;
  return {
    font: fam.fonts.display,
    sizePct: fam.type.body.sizePct,
    bold: fam.type.body.weight >= 700 ? 1 : 0,
    primary: fam.colour.primary,
    secondary: fam.colour.secondary,
    outlinePx: fam.fx.outlinePx,
    shadowPx: fam.fx.shadowPx,
    boxOpacity: 0,
    blur: fam.fx.blur,
    fadeInMs: 200,
    fadeOutMs: 180,
    popFromPct: 100,
    popMs: 0,
    karaoke: false,
    case: fam.type.body.case,
    spacing: 0,
    smartGroup: true,
    maxWordsPerLine: fam.rhythm.maxWordsPerLine,
    keywordScalePct: 112,
    staggerMs: 42,
    wordFadeMs: 150,
    easeAccel: 0.5,
    emphasisMaxTier: fam.emphasis.maxTier,
    styleId: fam.id,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Motion Graphics V1 — per-beat MOTION SIGNATURES. Each narrative treatment
// (from the engine) animates DIFFERENTLY so a video reads as a designed sequence,
// not a uniform subtitle track (Design Bible §B1/A4/A5). Values are scale-in
// start-% (support/keyword), overshoot-%, per-word fade ms, stagger ms; `hold`
// beats barely move (still, fade only) so motion elsewhere owns the frame.
// ═══════════════════════════════════════════════════════════════════════════
interface MotionSig {
  supportPop: number; keyPop: number; overshoot: number;
  wordFadeMs: number; staggerMs: number; hold?: boolean; fadeInMs?: number;
}
const MOTION_SIGNATURES: Record<string, MotionSig> = {
  // Explodes in — punchy, fast, deep dip + strong overshoot. Owns the 2s window.
  hook:      { supportPop: 48, keyPop: 42, overshoot: 9,  wordFadeMs: 130, staggerMs: 26 },
  // The number detonates from small with big overshoot; support barely moves → the figure is the star.
  stat:      { supportPop: 86, keyPop: 40, overshoot: 11, wordFadeMs: 150, staggerMs: 46 },
  // Snap — quick, tight stagger, a pattern interrupt that marks the pivot.
  turn:      { supportPop: 64, keyPop: 56, overshoot: 7,  wordFadeMs: 120, staggerMs: 20 },
  // Drift — slow, soft, no overshoot; a question invites thought.
  question:  { supportPop: 86, keyPop: 82, overshoot: 0,  wordFadeMs: 220, staggerMs: 60, fadeInMs: 240 },
  // Calm confidence — gentle slow rise, minimal overshoot.
  cta:       { supportPop: 88, keyPop: 84, overshoot: 3,  wordFadeMs: 200, staggerMs: 55, fadeInMs: 220 },
  // Default gentle fade-rise (the V3 baseline).
  statement: { supportPop: 72, keyPop: 56, overshoot: 5,  wordFadeMs: 150, staggerMs: 45 },
  // Barely moves — still, fade only. Inserted on a rhythm so the next motion pops.
  hold:      { supportPop: 100, keyPop: 100, overshoot: 0, wordFadeMs: 0,  staggerMs: 0, hold: true },
};

// ═══════════════════════════════════════════════════════════════════════════
// V3 Phase 2 — Caption Intelligence (deterministic; NO AI/ASR/LLM).
// Groups words into 1–3 word lines at natural boundaries and picks ONE emphasised
// keyword per line by a fixed priority. Same input always → same output.
// ═══════════════════════════════════════════════════════════════════════════

/** Function words that must never be emphasised nor isolated on their own line. */
const STOP_WORDS = new Set([
  "the", "a", "an", "of", "to", "in", "for", "with", "and", "or", "but", "on",
  "at", "by", "as", "is", "are", "am", "be", "been", "being", "was", "were", "it",
  "its", "this", "that", "these", "those", "from", "into", "than", "then", "so",
  "your", "you", "our", "we", "us", "my", "me", "i", "he", "she", "they", "them",
  "his", "her", "their", "if", "up", "out", "off", "no", "not", "do", "does",
]);
/** High-intent verbs (Style Guide priority #2). */
const POWER_VERBS = new Set([
  "save", "stop", "start", "build", "win", "grow", "boost", "unlock", "discover",
  "transform", "create", "get", "make", "cut", "double", "triple", "launch",
  "scale", "earn", "learn", "master", "avoid", "fix", "prove", "join", "own",
  "ship", "close", "convert", "reduce", "increase", "turn", "switch", "upgrade",
]);
/** Emotion words (Style Guide priority #3). */
const EMOTION_WORDS = new Set([
  "amazing", "incredible", "effortless", "beautiful", "powerful", "stunning",
  "love", "hate", "fear", "wow", "insane", "unbelievable", "perfect", "worst",
  "best", "free", "instantly", "finally", "secret", "proven", "guaranteed",
  "easy", "simple", "fast", "new", "now", "today", "never", "always",
]);

/** A number/quantity token: digits, %, $, currency, "10x", "3rd". Kept with its
 * unit and always the top emphasis priority. */
function isNumberish(w: string): boolean {
  return /[0-9]/.test(w) || /^[$£€%]+$/.test(w);
}

const norm = (w: string): string => w.toLowerCase().replace(/^[^\p{L}\p{N}$£€%]+|[^\p{L}\p{N}$£€%]+$/gu, "");

/**
 * Deterministic 1–3 word grouping into ≤2 lines. Rules (Style Guide §3):
 * keep a number with its following unit, keep consecutive Capitalised names
 * together, never leave a stop-word alone at a line edge, never a full sentence.
 * Short captions (≤ maxPerLine words) stay on one line.
 */
export function groupIntoLines(words: string[], maxPerLine = 3): string[][] {
  const n = words.length;
  if (n === 0) return [];
  if (n <= maxPerLine) return [words];

  // Allowed break BEFORE index i? Not mid number+unit, not mid Capitalised-name
  // run, not right after a leading stop-word that would dangle at a line end.
  const allowedBreakBefore = (i: number): boolean => {
    if (i <= 0 || i >= n) return false;
    const prev = words[i - 1], cur = words[i];
    if (isNumberish(prev) && !isNumberish(cur) && /^\p{Ll}/u.test(cur)) return false; // "50 %" / "10 miles"
    const cap = (w: string) => /^\p{Lu}/u.test(w);
    if (cap(prev) && cap(cur)) return false; // name run "New York"
    if (STOP_WORDS.has(norm(prev))) return false; // don't end a line on a stop-word
    return true;
  };

  // Pick the allowed break nearest the midpoint that keeps both lines ≤ maxPerLine.
  const mid = Math.ceil(n / 2);
  let best = -1, bestDist = Infinity;
  for (let i = 1; i < n; i++) {
    if (i > maxPerLine || n - i > maxPerLine) continue; // both lines must fit
    if (!allowedBreakBefore(i)) continue;
    const d = Math.abs(i - mid);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  if (best === -1) {
    // Relax the fit rule if no ideal split exists; still avoid dangling stop-words.
    for (let i = 1; i < n; i++) {
      if (!allowedBreakBefore(i)) continue;
      const d = Math.abs(i - mid);
      if (d < bestDist) { bestDist = d; best = i; }
    }
  }
  if (best === -1) best = mid; // last resort: balanced split
  return [words.slice(0, best), words.slice(best)];
}

/** Pick ONE keyword index in a line by fixed priority; -1 if none (all stop-words). */
export function selectKeywordIndex(line: string[]): number {
  let numberIdx = -1, verbIdx = -1, emotionIdx = -1, nounIdx = -1, longIdx = -1, longLen = -1;
  for (let i = 0; i < line.length; i++) {
    const w = norm(line[i]);
    if (!w || STOP_WORDS.has(w)) continue;
    if (numberIdx === -1 && isNumberish(line[i])) numberIdx = i;
    if (verbIdx === -1 && POWER_VERBS.has(w)) verbIdx = i;
    if (emotionIdx === -1 && EMOTION_WORDS.has(w)) emotionIdx = i;
    if (nounIdx === -1 && /^\p{Lu}/u.test(line[i])) nounIdx = i; // Capitalised → strong/proper noun
    if (w.length > longLen) { longLen = w.length; longIdx = i; }
  }
  if (numberIdx !== -1) return numberIdx;
  if (verbIdx !== -1) return verbIdx;
  if (emotionIdx !== -1) return emotionIdx;
  if (nounIdx !== -1) return nounIdx;
  return longIdx;
}

/** Caption engine → "static" (Legacy default) | "animated". The per-render
 * profile flag (explicit) ALWAYS wins; CAPTION_ENGINE is a dev-only override
 * used only when no per-render flag is passed. Neither set → static (Legacy).
 * There is deliberately NO global-profile default here — Modern is per-render. */
function resolveCaptionEngine(explicit?: "static" | "animated"): "static" | "animated" {
  if (explicit === "animated" || explicit === "static") return explicit;
  const env = (process.env.CAPTION_ENGINE ?? "").trim().toLowerCase();
  return env === "animated" ? "animated" : "static";
}

/** Caption preset. Per-render flag (explicit) wins; else the CAPTION_STYLE dev
 * override; else "classic". Accepts spacing/hyphen variants ("Bold Creator"). */
function resolveCaptionStyle(explicit?: CoreCaptionPreset): CoreCaptionPreset {
  const CORE = ["classic", "bold_creator", "minimal", "corporate"] as const;
  if (explicit && CORE.includes(explicit)) return explicit;
  const env = (process.env.CAPTION_STYLE ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return CORE.includes(env as CoreCaptionPreset) ? (env as CoreCaptionPreset) : "classic";
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
  /** V3 — brand accent "#RRGGBB" for keyword emphasis. undefined → scale-only
   * (Phase-2 behaviour). Supplied by the composer (brand palette → marigold). */
  accentColor?: string,
): string {
  const width = dims?.width ?? 1080;
  const height = dims?.height ?? 1920;
  const baseSize = Math.round(preset.sizePct * height);

  // V4 Presentation Engine — for smart presets, source grouping + keyword +
  // per-beat hierarchy from the engine (upgraded emphasis lexicon, overflow-safe
  // sizing). Fail-safe: any error → null → the inline V3 helpers below still run.
  // Legacy/non-smart presets never call it.
  let engineBeats: ReturnType<typeof runPresentationEngine>["model"]["beats"] | null = null;
  if (preset.smartGroup) {
    try {
      engineBeats = runPresentationEngine({
        captions,
        frame: { width, height },
        accentColor,
        config: { smartGroup: true, maxWordsPerLine: preset.maxWordsPerLine ?? 3, baseFontPx: baseSize, emphasisMaxTier: preset.emphasisMaxTier },
      }).model.beats;
      // V5 — Presentation Core: a style family decides per-beat typography (semantic
      // role → size/weight/tracking/case), layout archetype, and motion. The render
      // loop below serializes that IR; when absent it falls back to the preset (V4).
      const style = getStyleFamily(preset.styleId);
      if (style && engineBeats) engineBeats = applyStyle(style, engineBeats, { width, height });
    } catch {
      engineBeats = null;
    }
  }

  // V5 — the active style (recipe source of truth). The compiler reads the recipe to
  // decide which primitives to compose; the philosophy contains no animation code.
  const activeStyle = preset.smartGroup ? getStyleFamily(preset.styleId) : null;
  const events = captions
    .map((c, ci) => {
      const beat = preset.smartGroup ? engineBeats?.[ci] : undefined;
      // Per-beat hierarchy: hooks/short beats render larger (fontMult>1). Only
      // added when it differs from the base so most beats are unchanged.
      // V5 — the Typography Engine's decided spec (semantic role → size/tracking/
      // case), overflow-guarded upstream. When present it OWNS size + tracking; the
      // compiler just serializes it. Absent → the V4 fontMult behaviour (byte-identical).
      const styleType = beat?.type as
        | { role: string; fontPx: number; trackingPx: number; case: "sentence" | "upper" | "title" }
        | undefined;
      // Composition placement is reused by the entrance (\move/\pos) AND the
      // decoration line below, so resolve it once here.
      const bArchetype = ((beat?.layout as { archetype?: string } | undefined)?.archetype ??
        "centered") as Archetype;
      const placement = styleType ? place(bArchetype, 0, 1, { width, height }) : null;
      const fontMult = (beat?.layout?.fontMult as number | undefined) ?? 1;
      const beatFs = styleType
        ? `\\fs${styleType.fontPx}`
        : fontMult !== 1 ? `\\fs${Math.round(baseSize * fontMult)}` : "";
      // Optical tracking: large display type reads premium with slightly TIGHTER
      // letter-spacing (negative \fsp). V5: from the type spec; else V4 heuristic.
      const beatTrack = styleType
        ? (styleType.trackingPx !== 0 ? `\\fsp${styleType.trackingPx}` : "")
        : fontMult >= 1.4 ? "\\fsp-3" : fontMult >= 1.2 ? "\\fsp-2" : "";

      // Motion Graphics V1 — per-beat treatment → motion signature. Each narrative
      // beat animates in its own way (hook explodes, question drifts, stat pops,
      // turn snaps, cta glides), and ~1 in 3 ordinary statements HOLDS (barely
      // moves) so the moving beats own the frame. Deterministic; smart presets only.
      const treatment = (beat?.treatment as string | undefined) ?? (ci === 0 ? "hook" : "statement");
      const effTreatment = treatment === "statement" && ci % 3 === 2 ? "hold" : treatment;
      // V5: the style's per-treatment motion signature (on beat.motion) wins; a
      // hold beat still overrides to stillness; else the built-in signature table.
      const styleMotion = beat?.motion as MotionSig | undefined;
      const sig: MotionSig =
        effTreatment === "hold"
          ? MOTION_SIGNATURES.hold
          : styleMotion && typeof styleMotion.supportPop === "number"
            ? styleMotion
            : MOTION_SIGNATURES[effTreatment] ?? MOTION_SIGNATURES.statement;

      // V4 Phase 4 — per-word staggered reveal (smart presets): the whole-caption
      // scale-pop is replaced by per-word scale-in below, so the event keeps only
      // the opacity fade + glow. Non-stagger presets are UNCHANGED (byte-identical).
      // Hold beats set stagger 0 → no per-word entrance (still, fade only).
      const stagger = preset.smartGroup && preset.staggerMs && !sig.hold ? sig.staggerMs : 0;
      // V5 Composition Engine — PLACE the beat with the Layout primitive (\an\pos)
      // instead of auto-centered \an5, so beats sit in deliberate positions (hero
      // upper-middle, stat centred, etc.) — the #1 fix for the "centered subtitle"
      // tell. Only when a style is active; fail-safe → no \pos (current centring).
      let placeTag = "";
      if (styleType && placement) {
        try {
          // Motion Engine — kinetic RISE-into-place (a designed slide-up reveal)
          // unless the beat HOLDS (still beats stay put). Rise distance scales with
          // type size; duration matches the entrance fade. Composes the layout
          // primitive; `\move` replaces `\pos`.
          const risePx = Math.round(Math.max(28, styleType.fontPx * 0.32));
          const riseMs = sig.fadeInMs ?? preset.fadeInMs;
          placeTag = sig.hold ? posTag(placement) : moveIn(placement, risePx, riseMs);
        } catch { placeTag = ""; }
      }
      // V5 Decoration Engine — captured for the sparse accent line (built after the
      // grouped lines are known, at the return).
      let decoLines: string[][] | null = null;
      const entrance =
        placeTag + beatFs + beatTrack +
        `\\fad(${sig.fadeInMs ?? preset.fadeInMs},${preset.fadeOutMs})` +
        (!stagger && !sig.hold && preset.popMs > 0 && preset.popFromPct !== 100
          ? `\\fscx${preset.popFromPct}\\fscy${preset.popFromPct}\\t(0,${preset.popMs},\\fscx100\\fscy100)`
          : "") +
        (preset.blur > 0 ? `\\blur${preset.blur}` : "");

      let text: string;
      if (preset.smartGroup) {
        // V3 Phase 2 — deterministic 1–3 word chunks + one emphasised keyword/line.
        // Keyword index computed on PRE-case words (preserves capitalisation for
        // proper-noun detection); casing is then applied per line.
        // V4: engine grouping + keyword (upgraded lexicon) when available; else the
        // inline V3 helpers (fail-safe). Grouping algorithm is identical either way.
        const grouped: string[][] = beat
          ? beat.lines.map((l) => l.words)
          : groupIntoLines(
              (c.lineBreaks.length > 0 ? c.lineBreaks.join(" ") : c.text).split(/\s+/).filter(Boolean),
              preset.maxWordsPerLine ?? 3,
            );
        const kwIdx: number[] = beat?.keywordByLine
          ? beat.keywordByLine.map((k) => (k == null ? -1 : k))
          : grouped.map((lw) => selectKeywordIndex(lw));
        const casedWords = grouped.map((lw) =>
          applyCase(lw.join(" "), styleType?.case ?? preset.case).split(/\s+/).filter(Boolean),
        );
        decoLines = casedWords; // for the Decoration Engine accent line (below)
        // V5 Composition Engine — when the philosophy declares a per-beat COMPOSITION,
        // the compiler DELEGATES layout to it (the "pure recipe executor" path):
        // renderComposedBeat places every line per the composition + emphasis, reveals
        // per the recipe, emphasises the focal word, and draws the composition's
        // decoration anchors. Gated on a smart preset whose active style has
        // compositionByTreatment (e.g. Premium) + a resolved type spec — every existing
        // preset (no compositionByTreatment) falls through to the per-word path below,
        // BYTE-IDENTICAL. The philosophy owns the design; the compiler only executes it.
        const compId =
          styleType && activeStyle?.compositionByTreatment
            ? activeStyle.compositionByTreatment[treatment as keyof typeof activeStyle.compositionByTreatment]
            : undefined;
        if (compId && styleType) {
          return renderComposedBeat({
            compositionId: compId,
            lines: casedWords.map((lw) => lw.join(" ")),
            keywordByLine: kwIdx,
            frame: { width, height },
            startMs: c.startMs,
            endMs: c.endMs,
            baseFontPx: styleType.fontPx,
            accentColorAss: accentColor ? assColorTag(accentColor) : "",
            secondaryColorAss: assColorTag(preset.secondary),
            attention: activeStyle?.recipe?.attention,
            styleName: "Caption",
            reveal: activeStyle?.recipe?.reveal?.[0] ?? "riseFade",
            exit: activeStyle?.recipe?.exit?.[0] ?? "dissolve",
            motion: sig.hold ? "hold" : activeStyle?.recipe?.motion?.[0] ?? "hold",
            decoration: activeStyle?.recipe?.decoration,
            timing: activeStyle?.recipe?.timing,
            trackingBias: (activeStyle?.recipe?.typography ?? []).includes("wideTracking") ? 0.05 : 0,
            fadeInMs: sig.fadeInMs ?? preset.fadeInMs,
            fadeOutMs: preset.fadeOutMs,
          });
        }
        if (preset.karaoke) {
          const flat = casedWords.flat();
          const runs = karaokeRuns(flat, c.startMs, c.endMs);
          const kTag = preset.karaokeFill ? "kf" : "k";
          const KS = preset.keywordScalePct ?? 108;
          // Keyword emphasis (Phase 3): scale + brand-accent colour; a NUMERIC
          // keyword also switches to IBM Plex Mono (Style Guide "proof/data" cue).
          // accentColor absent → scale-only (Phase-2 behaviour). \1c uses 6-hex.
          const accentAss = accentColor ? assColorTag(accentColor) : "";
          const primaryAss = assColorTag(preset.primary);
          const wordFade = sig.wordFadeMs || (preset.wordFadeMs ?? 140);
          const accelStr = preset.easeAccel && preset.easeAccel !== 1 ? `${preset.easeAccel},` : "";
          // Per-beat CHOREOGRAPHY (Motion Graphics V1): the treatment's signature
          // sets how deep the words dip, how hard they overshoot, how fast they
          // stagger — so a hook explodes, a question drifts, a stat detonates.
          const SUPPORT_POP = sig.supportPop; // support word scale-in start-% (→ 100)
          const KEYWORD_POP = sig.keyPop;     // keyword dip (→ its scale)
          // V5 Layout Engine — NUMBER layout ("large-number screen"): the figure
          // DOMINATES and the support words recede, so a stat reads as a designed
          // metric moment, not a flat line. Uses the existing per-word scale (no
          // re-grouping → keyword indices stay in sync). Other layouts unchanged.
          const numberLayout = (beat?.layout as { archetype?: string } | undefined)?.archetype === "number";
          const kwTargetScale = numberLayout ? 172 : KS;
          const supTargetScale = numberLayout ? 78 : 100;
          let k = 0;
          let gi = 0; // global word index for the stagger offset
          text = casedWords
            .map((lw, li) =>
              lw
                .map((w, wi) => {
                  const run = runs[k++];
                  const isKw = wi === kwIdx[li];
                  const isNum = isKw && isNumberish(w);
                  const target = isKw ? kwTargetScale : supTargetScale; // number layout → figure dominates
                  const off = gi * stagger;
                  gi++;
                  // Non-stagger + non-keyword → EXACT V3 output (byte-identical).
                  if (!stagger && !isKw) return `{\\${kTag}${run}}${escapeAssText(w)}`;
                  const popFrom = isKw ? KEYWORD_POP : SUPPORT_POP;
                  const wf = isKw ? wordFade + 40 : wordFade; // keyword settles slower
                  // Kinetic V3 — OVERSHOOT settle (scale eases PAST target, then
                  // relaxes back: a spring that reads "designed", not a linear pop)
                  // + a focus-pull on the keyword only (brief \blur that resolves,
                  // like a rack focus). Two \t segments = anticipation/overshoot/
                  // follow-through that libass' single-exponent \t can't do alone.
                  const OS = sig.overshoot; // overshoot % (per treatment; 0 = none)
                  const SETTLE = 90;   // ms to relax from overshoot back to target
                  const over = target + OS;
                  const blurIn = isKw ? `\\blur${preset.blur + 6}` : "";
                  const blurTo = isKw ? `\\blur${preset.blur}` : "";
                  const scale = stagger
                    ? `\\fscx${popFrom}\\fscy${popFrom}${blurIn}` +
                      `\\t(${off},${off + wf},${accelStr}\\fscx${over}\\fscy${over}${blurTo})` +
                      `\\t(${off + wf},${off + wf + SETTLE},\\fscx${target}\\fscy${target})`
                    : isKw
                      ? `\\fscx${KS}\\fscy${KS}`
                      : "";
                  const pre = scale + (isKw && accentAss ? `\\1c${accentAss}` : "") + (isNum ? `\\fn${FONT.MONO}` : "");
                  // Reset only what leaks to the next word: colour, mono font, and
                  // (non-stagger only) the static keyword scale.
                  const resetParts: string[] = [];
                  if (!stagger && isKw) resetParts.push("\\fscx100\\fscy100");
                  if (isKw && accentAss) resetParts.push(`\\1c${primaryAss}`);
                  if (isNum) resetParts.push(`\\fn${preset.font}`);
                  const post = resetParts.length ? `{${resetParts.join("")}}` : "";
                  return `{\\${kTag}${run}${pre}}${escapeAssText(w)}${post}`;
                })
                .join(" "),
            )
            .join(" \\N ");
        } else {
          text = casedWords.map((lw) => lw.map((w) => escapeAssText(w)).join(" ")).join(" \\N ");
        }
      } else {
        // V2 path — byte-identical (uses the caption's own lineBreaks, no emphasis).
        const raw = c.lineBreaks.length > 0 ? c.lineBreaks : [c.text];
        const lines = raw.length <= 2 ? raw : [raw[0], raw.slice(1).join(" ")];
        const cased = lines.map((l) => applyCase(l, preset.case));
        if (preset.karaoke) {
          const perLineWords = cased.map((l) => l.split(/\s+/).filter(Boolean));
          const flat = perLineWords.flat();
          const runs = karaokeRuns(flat, c.startMs, c.endMs);
          const kTag = preset.karaokeFill ? "kf" : "k"; // smooth fill vs instant
          let k = 0;
          text = perLineWords
            .map((lw) => lw.map((w) => `{\\${kTag}${runs[k++]}}${escapeAssText(w)}`).join(" "))
            .join(" \\N ");
        } else {
          text = cased.map((l) => escapeAssText(l)).join(" \\N ");
        }
      }
      const mainEvent = `Dialogue: 0,${fmt(c.startMs)},${fmt(c.endMs)},Caption,,0,0,0,,{${entrance}}${text}`;
      // V5 Decoration Engine — a SPARSE drawn accent line under KEY beats (hero /
      // statistic / cta roles), drawing on L→R: a "minimal line motion graphics"
      // geometric element that reads as designed, not a subtitle. Emitted as a second
      // Dialogue event. Only when a style is active + a brand accent exists.
      let decoEvent = "";
      const recipeWantsAccentLine = activeStyle?.recipe?.decoration?.includes("accentLine") ?? true;
      if (styleType && placement && decoLines && accentColor && recipeWantsAccentLine &&
          (styleType.role === "hero" || styleType.role === "statistic" || styleType.role === "cta")) {
        const fpx = styleType.fontPx;
        const blockH = decoLines.length * fpx * 1.12;
        const lineY = placement.y + Math.round(blockH / 2) + Math.round(fpx * 0.32);
        const widest = Math.max(...decoLines.map((lw) => lineWidthPx(lw.join(" "), fpx)));
        const lw2 = Math.round(Math.min(widest * 0.6, width * 0.42));
        const lh2 = Math.max(3, Math.round(fpx * 0.045));
        const t = { offMs: (sig.fadeInMs ?? preset.fadeInMs) + 140, durMs: 340, accel: 0.6 };
        decoEvent = "\n" + `Dialogue: 0,${fmt(c.startMs)},${fmt(c.endMs)},Caption,,0,0,0,,` +
          accentLine(width / 2, lineY, lw2, lh2, assColorTag(accentColor), t);
      }
      return mainEvent + decoEvent;
    })
    .join("\n");
  return buildAnimatedHeader(preset, width, height) + events + "\n";
}
