/**
 * PRESENTATION INTELLIGENCE — beat SIGNALS. Pure content analysis of a story beat, the
 * raw material a "creative director" reads before deciding how to present it. No AI/LLM —
 * deterministic classification from the existing lexicon. These signals drive the intent
 * derivation + composition decision (decide.ts) and the QA scoring (score.ts).
 */
import { isNumberish, PAIN_WORDS, POWER_VERBS, CONTRAST_PIVOTS, norm } from "../lexicon";

export interface BeatSignals {
  /** Total words across all lines. */
  wordCount: number;
  lineCount: number;
  /** Any numeric/%/currency token present. */
  hasNumber: boolean;
  /** A [label, NUMBER, unit]-shaped beat — a real statistic worth a card. */
  numberIsStructured: boolean;
  isQuestion: boolean;
  /** before/after · old/new · vs · a contrast pivot — two things compared. */
  hasContrast: boolean;
  hasPain: boolean;
  /** Imperative/CTA verb (start/try/get/join/watch/…). */
  hasCTA: boolean;
  /** A quotation (quote marks or an em-dash attribution). */
  isQuote: boolean;
  /** ≤2 words total — a hero/title moment. */
  isShort: boolean;
  /** First line index carrying a keyword (−1 = none). */
  keywordLine: number;
}

const CTA_RE = /\b(start|try|get|join|watch|read|book|download|sign|shop|learn|discover|claim|grab)\b/i;
const CONTRAST_RE = /\b(vs|versus|before|after|old|new|then|now|instead)\b/i;
const QUESTION_RE = /^(how|why|what|when|who|where|which|is|are|do|does|can|should|would|will)\b/i;

/** Analyse a grouped beat (lines of words) + its per-line keyword indices → signals. */
export function analyzeBeat(lines: string[][], keywordByLine: number[]): BeatSignals {
  const flat = lines.flat();
  const wordCount = flat.length;
  const lineCount = lines.length;
  const text = flat.join(" ");
  const hasNumber = flat.some((w) => isNumberish(w));
  // Structured stat: among ≥2 lines, at least one SHORT line (≤2 words) contains the number
  // — i.e. the figure stands on/near its own line with label/unit around it.
  const numberIsStructured = lineCount >= 2 && lines.some((l) => l.length <= 2 && l.some((w) => isNumberish(w)));
  const isQuestion = /\?\s*$/.test(text) || QUESTION_RE.test(text.trim());
  const hasContrast = flat.some((w) => CONTRAST_PIVOTS.has(norm(w))) || CONTRAST_RE.test(text);
  const hasPain = flat.some((w) => PAIN_WORDS.has(norm(w)));
  const hasCTA = POWER_VERBS.has(norm(flat[0] ?? "")) || CTA_RE.test(text);
  const isQuote = /["“”«»]/.test(text) || flat.some((w) => w === "—" || w.startsWith("—") || w.startsWith("–"));
  const isShort = wordCount <= 2;
  const keywordLine = keywordByLine.findIndex((k) => k >= 0);
  return { wordCount, lineCount, hasNumber, numberIsStructured, isQuestion, hasContrast, hasPain, hasCTA, isQuote, isShort, keywordLine };
}
