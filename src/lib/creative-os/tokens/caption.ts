/**
 * OttoFlow Creative OS — Caption token dictionary (Phase 5).
 *
 * The canonical caption personalities from the Caption System (Phase 8) as data —
 * a coordinated setting of a few dials (chunk size, emphasis intensity, presence,
 * ground, pace) rather than a bespoke design each time. Pure — no logic, no
 * rendering. Registers select/tune a personality in a later cycle.
 *
 * Compatibility: every field name maps 1:1 onto the production AnimatedPreset in
 * ffmpeg-pipeline/ass-captions.ts (maxWordsPerLine, emphasisMaxTier,
 * keywordScalePct, sizePct, boxOpacity, fadeInMs, staggerMs, case), so a
 * personality resolves cleanly into preset overrides with no compiler change.
 * Nothing here is wired into a render; it is consumed only through the engine +
 * Render Profile mechanism.
 */

/** A caption personality — a coordinated dial setting (Caption System §1). */
export interface CaptionPersonality {
  /** Words per on-screen chunk (chunk size). */
  chunkWords: number;
  /** Max emphasis tier eligible for a keyword highlight (lower = more restrained). */
  emphasisMaxTier: number;
  /** Emphasised-word scale % (108 = a light lift; higher = punchier). */
  keywordScalePct: number;
  /** Caption height as a fraction of frame height (presence). */
  sizePct: number;
  /** Ground/plate opacity 0..1 (0 = near-invisible; higher = stronger scrim). */
  boxOpacity: number;
  /** Entrance fade / pace (ms; lower = brisker). */
  fadeInMs: number;
  /** Per-word stagger (ms). */
  staggerMs: number;
  case: "sentence" | "upper" | "title";
}

export type CaptionMode = "documentary" | "founder" | "luxury" | "ugc" | "default";

export const CAPTION_MODES: readonly CaptionMode[] = [
  "documentary", "founder", "luxury", "ugc", "default",
];

/**
 * The register-neutral personality table (Caption System §6 worked modes + a
 * default). Luxury: few large chunks, slow, minimal emphasis, near-invisible
 * ground. Founder: conversational, earned emphasis, confident. Documentary: calm
 * witness, weight-only emphasis, restrained plate, lower presence. UGC:
 * single-word cadence, fast, punchy.
 */
export const CAPTION_PERSONALITIES: Record<CaptionMode, CaptionPersonality> = {
  luxury: { chunkWords: 2, emphasisMaxTier: 3, keywordScalePct: 104, sizePct: 0.05, boxOpacity: 0.0, fadeInMs: 220, staggerMs: 55, case: "sentence" },
  founder: { chunkWords: 2, emphasisMaxTier: 5, keywordScalePct: 110, sizePct: 0.044, boxOpacity: 0.12, fadeInMs: 160, staggerMs: 40, case: "sentence" },
  documentary: { chunkWords: 3, emphasisMaxTier: 2, keywordScalePct: 100, sizePct: 0.038, boxOpacity: 0.28, fadeInMs: 200, staggerMs: 50, case: "sentence" },
  ugc: { chunkWords: 1, emphasisMaxTier: 6, keywordScalePct: 118, sizePct: 0.05, boxOpacity: 0.18, fadeInMs: 120, staggerMs: 24, case: "sentence" },
  default: { chunkWords: 3, emphasisMaxTier: 5, keywordScalePct: 108, sizePct: 0.042, boxOpacity: 0.2, fadeInMs: 160, staggerMs: 45, case: "sentence" },
};

/**
 * Reading rhythm floor — a caption is never allowed to clear faster than a viewer
 * can read it (Caption System §3/§7). Per-word budget, and a hard minimum per
 * chunk regardless of length.
 */
export const READING_FLOOR = { minMsPerWord: 180, minChunkMs: 700 } as const;
