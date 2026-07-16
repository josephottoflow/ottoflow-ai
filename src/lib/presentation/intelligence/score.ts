/**
 * PRESENTATION QA — self-scoring. Deterministic functions that rate how well a candidate
 * COMPOSITION presents a given beat (the "would a creative director choose this?" check).
 * The decision layer (decide.ts) scores every candidate and picks the best; a low score
 * automatically steers to a better choice. Pure — no render, no AI.
 *
 * Dimensions (0–100): FIT (does the structure match the content), READABILITY (will it fit
 * / stay legible), FOCUS (is there one clear focal point), NOISE (is it over-decorated).
 */
import type { BeatSignals } from "./signals";
import type { Composed } from "../primitives/composition";

export interface PresentationScore {
  fit: number;
  readability: number;
  focus: number;
  noise: number;
  /** Weighted overall (0–100). */
  total: number;
}

/** How well a composition's STRUCTURE matches the beat's content signals. */
export function scoreFit(compId: string, s: BeatSignals): number {
  switch (compId) {
    case "statistic-card": return s.numberIsStructured ? 96 : 28;
    case "quote-card": return s.isQuote ? 96 : 32;
    case "split": return s.hasContrast && s.lineCount >= 2 ? 92 : 38;
    case "comparison": return s.hasContrast && s.lineCount >= 2 ? 90 : 34;
    case "single-hero": return s.isShort ? 94 : s.lineCount === 1 ? 82 : 52;
    case "poster": return s.isShort || s.lineCount <= 2 ? 86 : 48;
    case "editorial-stack": return s.lineCount >= 2 ? 84 : 58;
    case "dual-hero": return s.lineCount === 2 ? 82 : 50;
    case "triple-hero": return s.lineCount >= 3 ? 80 : 44;
    case "timeline": return s.lineCount >= 3 && !s.hasNumber ? 82 : 34;
    case "dynamic-grid": return s.lineCount >= 3 ? 80 : 36;
    case "feature-callout": return s.hasNumber && s.lineCount >= 2 ? 84 : 40;
    case "lower-third": return 74;
    case "offset-left": case "offset-right": return s.lineCount >= 2 ? 76 : 62;
    case "floating-caption": return s.lineCount <= 2 ? 74 : 50;
    case "center-focus": return 78;   // the safe, universal default
    default: return 66;
  }
}

/** Legibility risk: tight compositions with a lot of words score lower (overflow/cramp).
 * Quote-card is NOT tight — quotes are inherently multi-word and it wraps gracefully. */
export function scoreReadability(compId: string, s: BeatSignals): number {
  const tight = compId === "single-hero" || compId === "poster" || compId === "statistic-card";
  if (tight && s.wordCount > 7) return 48;
  if (s.wordCount > 10) return 58;
  return 90;
}

/** One clear focal point? Long/flat multi-line beats without a keyword read as unfocused. */
export function scoreFocus(s: BeatSignals): number {
  if (s.keywordLine < 0 && s.lineCount >= 3) return 55;
  if (s.isShort) return 95;
  return 80;
}

/** Over-decoration penalty from the resolved arrangement (fewer, purposeful marks = better). */
export function scoreNoise(c: Composed): number {
  const d = c.decor.length;
  if (d <= 1) return 92;
  if (d <= 3) return 82;
  if (d <= 5) return 68;
  return 50;
}

/** Weighted overall for a candidate (Composed optional — noise defaults high without it). */
export function scorePresentation(compId: string, s: BeatSignals, c?: Composed): PresentationScore {
  const fit = scoreFit(compId, s);
  const readability = scoreReadability(compId, s);
  const focus = scoreFocus(s);
  const noise = c ? scoreNoise(c) : 85;
  // Fit-weighted: a clear content match (statistic/quote/contrast) should dominate so the
  // engine picks the RIGHT structure, not just the philosophy's habitual one.
  const total = Math.round(fit * 0.55 + readability * 0.2 + focus * 0.12 + noise * 0.13);
  return { fit, readability, focus, noise, total };
}
