/**
 * OttoFlow Creative OS — Caption Engine (Phase 5).
 *
 * A pure, deterministic resolver: caption mode → a personality (dial settings),
 * and a mapping from that personality to production-compatible preset overrides.
 * Plus the reading-rhythm floor (a caption never clears faster than a viewer can
 * read it). Driven entirely by the Phase 5 caption token dictionary.
 *
 * This is the token-driven counterpart to the hardcoded ANIMATED_PRESETS in the
 * ASS compiler. `toPresetOverrides` produces an object whose keys are all real
 * AnimatedPreset fields, so a register profile can merge it into a preset with no
 * compiler change. Nothing here is wired into a render; the personality is applied
 * only through the flag-gated activation seam + Render Profile mechanism.
 *
 * Purity: no clock, no I/O, no globals.
 */
import {
  CAPTION_PERSONALITIES,
  READING_FLOOR,
  type CaptionMode,
  type CaptionPersonality,
} from "../tokens/caption";

const KNOWN: readonly CaptionMode[] = ["documentary", "founder", "luxury", "ugc", "default"];

/** Resolve a mode to its personality. Unknown → default. Fresh object so callers
 * cannot mutate the token table. */
export function resolveCaptionPersonality(mode?: string): CaptionPersonality {
  const key = (mode && (KNOWN as string[]).includes(mode) ? mode : "default") as CaptionMode;
  return { ...CAPTION_PERSONALITIES[key] };
}

/** Preset overrides — every key is a real production AnimatedPreset field, so this
 * merges into a preset without any compiler change. */
export interface CaptionPresetOverrides {
  maxWordsPerLine: number;
  emphasisMaxTier: number;
  keywordScalePct: number;
  sizePct: number;
  boxOpacity: number;
  fadeInMs: number;
  staggerMs: number;
  case: "sentence" | "upper" | "title";
}

/** Map a personality to AnimatedPreset-compatible overrides. */
export function toPresetOverrides(p: CaptionPersonality): CaptionPresetOverrides {
  return {
    maxWordsPerLine: p.chunkWords,
    emphasisMaxTier: p.emphasisMaxTier,
    keywordScalePct: p.keywordScalePct,
    sizePct: p.sizePct,
    boxOpacity: p.boxOpacity,
    fadeInMs: p.fadeInMs,
    staggerMs: p.staggerMs,
    case: p.case,
  };
}

/** The minimum on-screen time (ms) a chunk of `wordCount` words needs to be read:
 * a per-word budget, floored by a hard minimum per chunk. */
export function readingFloorMs(wordCount: number): number {
  return Math.max(READING_FLOOR.minChunkMs, Math.max(0, wordCount) * READING_FLOOR.minMsPerWord);
}

/** True when a chunk stays on screen long enough to be read. */
export function meetsReadingFloor(durationMs: number, wordCount: number): boolean {
  return durationMs >= readingFloorMs(wordCount);
}

/** Extend a duration up to the reading floor (never shortens it). */
export function clampToReadingFloor(durationMs: number, wordCount: number): number {
  return Math.max(durationMs, readingFloorMs(wordCount));
}
