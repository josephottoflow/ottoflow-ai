/**
 * Presentation Engine V4 — deterministic emphasis lexicon (Phase 2).
 *
 * Pure word classification for Keyword Selection. NO AI/ASR/LLM. Curated word
 * lists implement the Style Guide V4 priority:
 *   number → pain → transformation → emotion → power-verb → contrast-pivot →
 *   strong (Capitalised) noun → longest non-stop-word.
 * Lists are data (extendable per brand/industry later) — logic never changes.
 */

/** Function words: never emphasised, never isolated at a line edge. */
export const STOP_WORDS = new Set([
  "the", "a", "an", "of", "to", "in", "for", "with", "and", "or", "but", "on",
  "at", "by", "as", "is", "are", "am", "be", "been", "being", "was", "were", "it",
  "its", "this", "that", "these", "those", "from", "into", "than", "then", "so",
  "your", "you", "our", "we", "us", "my", "me", "i", "he", "she", "they", "them",
  "his", "her", "their", "if", "up", "out", "off", "no", "not", "do", "does", "get",
]);

/** Priority #2 — pain / problem words. */
export const PAIN_WORDS = new Set([
  "stuck", "wasted", "waste", "chaos", "lost", "slow", "hard", "fail", "failing",
  "broken", "messy", "endless", "scattered", "confusing", "confused", "overwhelmed",
  "struggle", "struggling", "pain", "frustrating", "frustrated", "tired", "stop",
  "stopped", "problem", "problems", "risk", "expensive", "wrong", "hidden", "boring",
]);

/** Priority #3 — transformation / outcome words. */
export const TRANSFORMATION_WORDS = new Set([
  "unlock", "unlocked", "clarity", "clear", "effortless", "finally", "instantly",
  "instant", "transform", "transformed", "simple", "simpler", "faster", "easy",
  "easier", "smarter", "better", "focus", "focused", "flow", "seamless", "reclaim",
  "reclaimed", "organized", "control", "confident", "confidence", "freedom", "win",
]);

/** Priority #4 — emotion / urgency words. */
export const EMOTION_WORDS = new Set([
  "amazing", "incredible", "effortless", "beautiful", "powerful", "stunning",
  "love", "hate", "fear", "wow", "insane", "unbelievable", "perfect", "worst",
  "best", "free", "now", "never", "always", "secret", "proven", "guaranteed",
]);

/** Priority #5 — power verbs. */
export const POWER_VERBS = new Set([
  "save", "start", "build", "grow", "boost", "discover", "create", "make", "cut",
  "double", "triple", "launch", "scale", "earn", "learn", "master", "avoid", "fix",
  "prove", "join", "own", "ship", "close", "convert", "reduce", "increase", "turn",
  "switch", "upgrade",
]);

/** Priority #6 — contrast pivots: emphasise the word AFTER these. */
export const CONTRAST_PIVOTS = new Set(["but", "instead", "until", "without", "yet"]);

/** Trim surrounding punctuation, lower-case, keep currency/percent glyphs. */
export function norm(w: string): string {
  return w.toLowerCase().replace(/^[^\p{L}\p{N}$£€%]+|[^\p{L}\p{N}$£€%]+$/gu, "");
}

/** Number / quantity token: digits, %, $, currency. Always top emphasis. */
export function isNumberish(w: string): boolean {
  return /[0-9]/.test(w) || /^[$£€%]+$/.test(w);
}

/** Priority tier of a word (lower = higher priority). 99 = ineligible (stop-word). */
export function emphasisTier(word: string): number {
  const n = norm(word);
  if (!n || STOP_WORDS.has(n)) return 99;
  if (isNumberish(word)) return 1;
  if (PAIN_WORDS.has(n)) return 2;
  if (TRANSFORMATION_WORDS.has(n)) return 3;
  if (EMOTION_WORDS.has(n)) return 4;
  if (POWER_VERBS.has(n)) return 5;
  // 6 = contrast handled positionally in selectKeyword; 7 = strong (Capitalised) noun
  if (/^\p{Lu}/u.test(word)) return 7;
  return 8; // eligible; ranked by length as the final tiebreak
}
