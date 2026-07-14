/**
 * Presentation Engine V4 — deterministic word grouping + keyword pick (Phase 2).
 * Pure; no AI. Same input → same output.
 */
import {
  CONTRAST_PIVOTS,
  STOP_WORDS,
  emphasisTier,
  isNumberish,
  norm,
} from "./lexicon";

/**
 * Group words into ≤2 lines of 1–maxPerLine words at natural boundaries. Keeps a
 * number with its following unit, keeps consecutive Capitalised names together,
 * never leaves a stop-word dangling at a line edge. ≤ maxPerLine words → one line.
 */
export function groupIntoLines(words: string[], maxPerLine = 3): string[][] {
  const n = words.length;
  if (n === 0) return [];
  if (n <= maxPerLine) return [words];

  const cap = (w: string) => /^\p{Lu}/u.test(w);
  const allowedBreakBefore = (i: number): boolean => {
    if (i <= 0 || i >= n) return false;
    const prev = words[i - 1], cur = words[i];
    if (isNumberish(prev) && !isNumberish(cur) && /^\p{Ll}/u.test(cur)) return false; // "50 miles"
    if (cap(prev) && cap(cur)) return false; // name run "New York"
    if (STOP_WORDS.has(norm(prev))) return false; // don't end a line on a stop-word
    return true;
  };

  const mid = Math.ceil(n / 2);
  let best = -1, bestDist = Infinity;
  for (let i = 1; i < n; i++) {
    if (i > maxPerLine || n - i > maxPerLine) continue; // both lines must fit
    if (!allowedBreakBefore(i)) continue;
    const d = Math.abs(i - mid);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  if (best === -1) {
    for (let i = 1; i < n; i++) {
      if (!allowedBreakBefore(i)) continue;
      const d = Math.abs(i - mid);
      if (d < bestDist) { bestDist = d; best = i; }
    }
  }
  if (best === -1) best = mid;
  return [words.slice(0, best), words.slice(best)];
}

/**
 * Pick ONE keyword index in a line by the Style Guide V4 priority (number → pain →
 * transformation → emotion → power-verb → contrast-pivot-next → strong noun →
 * longest non-stop-word). Returns -1 if the line is all stop-words.
 */
export function selectKeyword(words: string[]): number {
  const tiers = words.map(emphasisTier);
  // Contrast pivot: the word AFTER "but/instead/until/without/yet" is elevated.
  for (let i = 0; i < words.length - 1; i++) {
    if (CONTRAST_PIVOTS.has(norm(words[i])) && tiers[i + 1] !== 99) {
      tiers[i + 1] = Math.min(tiers[i + 1], 6);
    }
  }
  let best = -1, bestTier = 99, bestLen = -1;
  for (let i = 0; i < words.length; i++) {
    if (tiers[i] === 99) continue;
    const len = norm(words[i]).length;
    if (tiers[i] < bestTier || (tiers[i] === bestTier && len > bestLen)) {
      bestTier = tiers[i]; bestLen = len; best = i;
    }
  }
  return best;
}

/**
 * Deterministic width estimate (px @ given font size) for overflow detection.
 * Uses a conservative average advance (~0.56em, matching the CTA wrapper) — no
 * font metrics needed; intentionally slightly over-estimates so nothing clips.
 */
export function estimateWidthPx(text: string, fontSizePx: number, trackingPx = 0): number {
  const AVG_ADVANCE = 0.56;
  return Math.ceil(text.length * (fontSizePx * AVG_ADVANCE + Math.max(0, trackingPx)));
}
