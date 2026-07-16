/**
 * PRESENTATION INTELLIGENCE — the DECISION. This is where the philosophy stops being a
 * static input and becomes an OUTPUT: the engine reads the beat's signals, derives a
 * presentation INTENT (what kind of moment is this?), generates candidate compositions,
 * SCORES each (Presentation QA), applies the philosophy as a bias, and picks the best —
 * exactly the call an elite creative director makes per beat. Pure/deterministic.
 *
 * The philosophy no longer dictates composition; it PREFERS. Strong content signals (a
 * real statistic, a quote, a contrast) can override the style's default because the fit
 * score wins. Weak/ambiguous beats fall to the philosophy's voice.
 */
import { compose, type CompContext, type Composed } from "../primitives/composition";
import { analyzeBeat, type BeatSignals } from "./signals";
import { scorePresentation, type PresentationScore } from "./score";

export type PresentationIntent =
  | "title" | "statistic" | "quote" | "contrast" | "cta" | "question" | "list" | "statement";

/** Read the beat's signals → the kind of presentation moment this is. */
export function deriveIntent(s: BeatSignals): PresentationIntent {
  if (s.isQuote) return "quote";
  if (s.numberIsStructured) return "statistic";
  if (s.hasContrast && s.lineCount >= 2) return "contrast";
  if (s.hasCTA && s.wordCount <= 4) return "cta";
  if (s.isQuestion) return "question";
  if (s.isShort) return "title";
  if (s.lineCount >= 3 && !s.hasNumber) return "list";
  return "statement";
}

/** Compositions worth considering for each intent (the director's shortlist). */
const CANDIDATES: Record<PresentationIntent, string[]> = {
  title: ["single-hero", "poster", "center-focus"],
  statistic: ["statistic-card", "center-focus"],
  quote: ["quote-card", "center-focus"],
  contrast: ["split", "comparison", "center-focus"],
  cta: ["single-hero", "center-focus"],
  question: ["center-focus", "single-hero"],
  list: ["dynamic-grid", "timeline", "center-focus"],
  statement: ["center-focus", "editorial-stack", "offset-left"],
};

export interface PresentationDecision {
  compositionId: string;
  intent: PresentationIntent;
  score: PresentationScore;
  reason: string;
}

function safeCompose(id: string, ctx: CompContext): Composed | null {
  try { return compose(id, ctx); } catch { return null; }
}

/**
 * Decide the composition for a beat. `philosophyPrefs` are the style's preferred
 * compositions (recipe.composition + its treatment default) — used as a bias, not a rule.
 */
export function decidePresentation(
  lines: string[][],
  keywordByLine: number[],
  frame: { width: number; height: number },
  fontPx: number,
  philosophyPrefs: string[] = [],
): PresentationDecision {
  const s = analyzeBeat(lines, keywordByLine);
  const intent = deriveIntent(s);
  const candidates = Array.from(new Set([...CANDIDATES[intent], ...philosophyPrefs, "center-focus"]));
  const ctx: CompContext = {
    frame, lineCount: lines.length, fontPx,
    keywordLine: s.keywordLine >= 0 ? s.keywordLine : undefined,
  };

  let bestId = "center-focus";
  let bestScore = scorePresentation("center-focus", s, safeCompose("center-focus", ctx) ?? undefined);
  let bestAdj = -1;
  for (const id of candidates) {
    const composed = safeCompose(id, ctx);
    if (!composed) continue;
    const sc = scorePresentation(id, s, composed);
    // Philosophy bias: a small bonus so, among comparably-fit options, the style's voice
    // wins — but a clearly better fit (statistic/quote/contrast) still overrides it.
    const adj = sc.total + (philosophyPrefs.includes(id) ? 4 : 0);
    if (adj > bestAdj) { bestAdj = adj; bestId = id; bestScore = sc; }
  }
  return {
    compositionId: bestId,
    intent,
    score: bestScore,
    reason: `${intent}→${bestId} (${bestScore.total}${philosophyPrefs.includes(bestId) ? "·style" : ""})`,
  };
}
