/**
 * Presentation Engine passes.
 *   Pass 1 Sentence Analysis   → flat tokenisation (Phase 2)
 *   Pass 2 Caption Grouping    → deterministic 1–3 word beats (Phase 2)
 *   Pass 3 Keyword Selection   → priority-lexicon keyword per line (Phase 2)
 *   Pass 4 Typography Layout   → per-beat role + fit           (Phase 3, no-op now)
 *   Pass 5 Motion Planning     → entrance/emphasis motion spec (Phase 4, no-op now)
 *   Pass 6 Overflow Detection  → flag lines exceeding safe width (Phase 2)
 *   Pass 7 Safe-Area Validation→ clamp into caption band       (Phase 3, no-op now)
 *   Pass 8 Presentation QA     → advisory scores               (Phase 7, no-op now)
 *
 * Contract: pure, deterministic, must not throw for control flow (the engine also
 * guards each with try/catch). Grouping/keyword run ONLY when config.smartGroup —
 * otherwise the caption's own lineBreaks are preserved (Legacy-ish presets),
 * keeping those byte-identical.
 */
import type { PresentationModel, PresentationPass } from "./types";
import { groupIntoLines, selectKeyword, estimateWidthPx } from "./grouping";
import { emphasisTier, norm, isNumberish, CONTRAST_PIVOTS, POWER_VERBS } from "./lexicon";

/**
 * Narrative TREATMENT of a beat (Motion Graphics V1) — deterministic from position
 * + content. Gives each beat its own visual/motion identity so a video reads as a
 * designed sequence, not a uniform subtitle track. Priority: hook (first beat) >
 * stat (has a number) > turn (has a contrast pivot) > question (ends "?") > cta
 * (last beat, imperative power-verb) > statement (default).
 */
function classifyTreatment(words: string[], index: number, total: number): string {
  if (words.length === 0) return "statement";
  const norms = words.map(norm);
  if (index === 0) return "hook";
  if (words.some(isNumberish)) return "stat";
  if (norms.some((w) => CONTRAST_PIVOTS.has(w))) return "turn";
  if (/\?["']?$/.test(words[words.length - 1] ?? "")) return "question";
  if (index === total - 1 && POWER_VERBS.has(norms[0] ?? "")) return "cta";
  return "statement";
}

const identity = (name: string): PresentationPass => ({ name, run: (m) => m });

/** Pass 1 — flat tokenisation of each beat's source text. */
export const sentenceAnalysisPass: PresentationPass = {
  name: "sentence-analysis",
  run(model: PresentationModel): PresentationModel {
    return {
      ...model,
      beats: model.beats.map((b) => ({
        ...b,
        words: b.sourceText.split(/\s+/).filter(Boolean),
      })),
    };
  },
};

/** Pass 2 — deterministic 1–maxWordsPerLine grouping (Modern smart presets only). */
export const captionGroupingPass: PresentationPass = {
  name: "caption-grouping",
  run(model: PresentationModel): PresentationModel {
    if (!model.config.smartGroup) return model; // preserve lineBreaks (byte-identical)
    const max = model.config.maxWordsPerLine;
    return {
      ...model,
      beats: model.beats.map((b) => {
        const words = b.words && b.words.length ? b.words : b.sourceText.split(/\s+/).filter(Boolean);
        const grouped = groupIntoLines(words, max);
        return { ...b, lines: grouped.map((w) => ({ words: w })) };
      }),
    };
  },
};

/** Pass 3 — one keyword per line via the priority lexicon (smart presets only). */
export const keywordSelectionPass: PresentationPass = {
  name: "keyword-selection",
  run(model: PresentationModel): PresentationModel {
    if (!model.config.smartGroup) return model;
    const maxTier = model.config.emphasisMaxTier ?? 8;
    // Premium restraint: when emphasis is gated to true payload words (maxTier ≤ 5),
    // highlight AT MOST ONE word for the whole on-screen beat — a professional editor
    // colours a single focal word per moment, not one per line. Creator presets
    // (maxTier ≥ 6) keep per-line emphasis for energy.
    const onePerBeat = maxTier <= 5;
    return {
      ...model,
      beats: model.beats.map((b) => {
        const perLine = b.lines.map((l) => {
          const i = selectKeyword(l.words, maxTier);
          return i >= 0 ? i : null;
        });
        if (!onePerBeat) return { ...b, keywordByLine: perLine };
        // Keep only the single strongest keyword (lowest tier, then longest).
        let keepLine = -1, bestTier = 99, bestLen = -1;
        perLine.forEach((idx, li) => {
          if (idx == null) return;
          const w = b.lines[li].words[idx];
          const t = emphasisTier(w), len = norm(w).length;
          if (t < bestTier || (t === bestTier && len > bestLen)) { bestTier = t; bestLen = len; keepLine = li; }
        });
        return { ...b, keywordByLine: perLine.map((idx, li) => (li === keepLine ? idx : null)) };
      }),
    };
  },
};

/** Pass 6 — flag lines whose estimated width exceeds the safe band (advisory in
 * Phase 2; Typography/Layout consumes it in later phases). Never mutates lines. */
export const overflowDetectionPass: PresentationPass = {
  name: "overflow-detection",
  run(model: PresentationModel): PresentationModel {
    if (!model.config.smartGroup) return model;
    // Nominal caption size (~4% H) + 84% safe width — deterministic estimate.
    const nominalPx = Math.round(0.04 * model.frame.height);
    const safeWidth = Math.round(model.frame.width * 0.84);
    return {
      ...model,
      beats: model.beats.map((b) => {
        const overflowLines = b.lines
          .map((l, i) => (estimateWidthPx(l.words.join(" "), nominalPx) > safeWidth ? i : -1))
          .filter((i) => i >= 0);
        return overflowLines.length
          ? { ...b, layout: { ...(b.layout ?? {}), overflowLines } }
          : b;
      }),
    };
  },
};

/**
 * Pass 4 — per-beat typography HIERARCHY (Phase 3). Assigns a role + font
 * multiplier so hooks / short punch beats DOMINATE and multi-word reads support —
 * the size contrast that makes editing feel intentional. Overflow-safe: the
 * multiplier is stepped down until the widest line fits the safe width, so bigger
 * type never clips or cramps (Priority 5). Deterministic; smart presets only.
 * Sizes follow a real modular scale (≈ major-third / perfect-fourth steps) so the
 * contrast is VISIBLE and intentional, not a timid few-percent nudge:
 *   hero     1.44×  — the hook (first beat) or any ≤2-word punch beat
 *   headline 1.24×  — a ≤3-word beat whose keyword is high-intent (tier ≤4)
 *   caption  1.00×  — default reads (unchanged)
 */
export const typographyLayoutPass: PresentationPass = {
  name: "typography-layout",
  run(model: PresentationModel): PresentationModel {
    if (!model.config.smartGroup) return model;
    const baseFontPx = model.config.baseFontPx ?? Math.round(0.04 * model.frame.height);
    const safeWidth = Math.round(model.frame.width * 0.84);
    const total = model.beats.length;
    return {
      ...model,
      beats: model.beats.map((b, i) => {
        const allWords = b.lines.flatMap((l) => l.words);
        const treatment = classifyTreatment(allWords, i, total);
        const totalWords = b.lines.reduce((a, l) => a + l.words.length, 0);
        const strongKeyword = (b.keywordByLine ?? []).some(
          (k, li) => k != null && emphasisTier(b.lines[li]?.words[k] ?? "") <= 4,
        );
        let role = "caption";
        let mult = 1;
        if (i === 0 || totalWords <= 2) { role = "hero"; mult = 1.44; }
        else if (strongKeyword && totalWords <= 3) { role = "headline"; mult = 1.24; }
        // Overflow guard: shrink the multiplier until the widest line fits.
        while (mult > 1) {
          const widest = Math.max(
            ...b.lines.map((l) => estimateWidthPx(l.words.join(" "), Math.round(baseFontPx * mult))),
          );
          if (widest <= safeWidth) break;
          mult = Math.max(1, +(mult - 0.06).toFixed(2));
        }
        // "Big OR coloured, not both" — a genuinely enlarged hero beat lets SIZE
        // carry the emphasis (Apple-style), so drop its keyword colour. A hero
        // that overflow-clamped back to ~base keeps its accent (it isn't actually
        // big). This variety is what stops emphasis feeling formulaic.
        const keywordByLine =
          role === "hero" && mult >= 1.3 && b.keywordByLine
            ? b.keywordByLine.map(() => null)
            : b.keywordByLine;
        return { ...b, role, treatment, keywordByLine, layout: { ...(b.layout ?? {}), fontMult: mult } };
      }),
    };
  },
};
export const motionPlanningPass: PresentationPass = identity("motion-planning");
export const safeAreaValidationPass: PresentationPass = identity("safe-area-validation");
export const presentationQaPass: PresentationPass = identity("presentation-qa");

/** The canonical ordered pipeline. */
export const DEFAULT_PASSES: readonly PresentationPass[] = [
  sentenceAnalysisPass,
  captionGroupingPass,
  keywordSelectionPass,
  typographyLayoutPass,
  motionPlanningPass,
  overflowDetectionPass,
  safeAreaValidationPass,
  presentationQaPass,
];
