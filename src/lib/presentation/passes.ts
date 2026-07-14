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
import { emphasisTier } from "./lexicon";

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
    return {
      ...model,
      beats: model.beats.map((b) => ({
        ...b,
        keywordByLine: b.lines.map((l) => {
          const i = selectKeyword(l.words);
          return i >= 0 ? i : null;
        }),
      })),
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
 *   hero     1.30×  — the hook (first beat) or any ≤2-word punch beat
 *   headline 1.12×  — a ≤3-word beat whose keyword is high-intent (number/pain/
 *                     transformation/emotion, tier ≤4)
 *   caption  1.00×  — default reads (unchanged)
 */
export const typographyLayoutPass: PresentationPass = {
  name: "typography-layout",
  run(model: PresentationModel): PresentationModel {
    if (!model.config.smartGroup) return model;
    const baseFontPx = model.config.baseFontPx ?? Math.round(0.04 * model.frame.height);
    const safeWidth = Math.round(model.frame.width * 0.84);
    return {
      ...model,
      beats: model.beats.map((b, i) => {
        const totalWords = b.lines.reduce((a, l) => a + l.words.length, 0);
        const strongKeyword = (b.keywordByLine ?? []).some(
          (k, li) => k != null && emphasisTier(b.lines[li]?.words[k] ?? "") <= 4,
        );
        let role = "caption";
        let mult = 1;
        if (i === 0 || totalWords <= 2) { role = "hero"; mult = 1.3; }
        else if (strongKeyword && totalWords <= 3) { role = "headline"; mult = 1.12; }
        // Overflow guard: shrink the multiplier until the widest line fits.
        while (mult > 1) {
          const widest = Math.max(
            ...b.lines.map((l) => estimateWidthPx(l.words.join(" "), Math.round(baseFontPx * mult))),
          );
          if (widest <= safeWidth) break;
          mult = Math.max(1, +(mult - 0.06).toFixed(2));
        }
        return { ...b, role, layout: { ...(b.layout ?? {}), fontMult: mult } };
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
