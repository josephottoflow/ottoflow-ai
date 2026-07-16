/**
 * OttoFlow · Premium — a presentation PHILOSOPHY, not a brand: restraint, obvious
 * size hierarchy, sparse colour, calm confident motion. Data only.
 *
 * Principles were extracted from the best luxury/editorial motion typography in the
 * industry and then made OttoFlow-native — no external visual identity is reproduced
 * or exposed. This is OttoFlow's own default premium language.
 */
import type { StyleFamily } from "./types";

const CALM = { easeAccel: 0.5 };

export const PREMIUM: StyleFamily = {
  id: "premium",
  group: "OttoFlow",
  label: "Premium",
  fonts: { display: "Plus Jakarta Sans", body: "Plus Jakarta Sans", mono: "IBM Plex Mono" },
  // Sizes as fraction of 1920. Body ≈ 104px; hero/statistic a real modular step up
  // (≥1.5×) so hierarchy is OBVIOUS; tracking tightens with size (optical); leading
  // tightens for stacked display.
  type: {
    hero:      { sizePct: 0.078, weight: 700, trackingPct: -0.02,  leadingMult: 1.05, case: "sentence" },
    display:   { sizePct: 0.068, weight: 700, trackingPct: -0.015, leadingMult: 1.08, case: "sentence" },
    headline:  { sizePct: 0.060, weight: 700, trackingPct: -0.01,  leadingMult: 1.12, case: "sentence" },
    section:   { sizePct: 0.056, weight: 700, trackingPct: 0,      leadingMult: 1.15, case: "sentence" },
    body:      { sizePct: 0.054, weight: 700, trackingPct: 0.004,  leadingMult: 1.18, case: "sentence" },
    caption:   { sizePct: 0.050, weight: 600, trackingPct: 0.006,  leadingMult: 1.20, case: "sentence" },
    statistic: { sizePct: 0.086, weight: 800, trackingPct: -0.01,  leadingMult: 1.05, case: "sentence" },
    cta:       { sizePct: 0.062, weight: 700, trackingPct: 0,      leadingMult: 1.10, case: "sentence" },
    brand:     { sizePct: 0.040, weight: 500, trackingPct: 0.02,   leadingMult: 1.20, case: "sentence" },
    footer:    { sizePct: 0.032, weight: 500, trackingPct: 0.02,   leadingMult: 1.20, case: "sentence" },
    micro:     { sizePct: 0.030, weight: 500, trackingPct: 0.03,   leadingMult: 1.20, case: "upper" },
  },
  roleByTreatment: {
    hook: "hero", stat: "statistic", turn: "headline",
    question: "headline", cta: "cta", statement: "body",
  },
  layoutByTreatment: {
    hook: "stacked", stat: "number", turn: "centered",
    question: "centered", cta: "centered", statement: "centered",
  },
  // Composition Engine — Premium's per-beat spatial STRUCTURE (where attention lives).
  // Restrained, editorial: heroes get an editorial stack, stats a metric card, quotes a
  // quote card, CTAs a single hero; ordinary statements stay a deliberate centre-focus.
  compositionByTreatment: {
    hook: "editorial-stack",
    // stat → center-focus (robust): emphasises the number word wherever grouping puts it.
    // statistic-card stays in the library for STRUCTURED [label,number,unit] data, which
    // free narration grouping doesn't guarantee.
    stat: "center-focus",
    turn: "single-hero",
    question: "center-focus",
    cta: "single-hero",
    statement: "center-focus",
  },
  motionByTreatment: {
    hook:      { supportPop: 48, keyPop: 42, overshoot: 9,  wordFadeMs: 130, staggerMs: 26, ...CALM },
    stat:      { supportPop: 86, keyPop: 40, overshoot: 11, wordFadeMs: 150, staggerMs: 46, ...CALM },
    turn:      { supportPop: 64, keyPop: 56, overshoot: 7,  wordFadeMs: 120, staggerMs: 20, ...CALM },
    question:  { supportPop: 86, keyPop: 82, overshoot: 0,  wordFadeMs: 220, staggerMs: 60, fadeInMs: 240, ...CALM },
    cta:       { supportPop: 88, keyPop: 84, overshoot: 3,  wordFadeMs: 200, staggerMs: 55, fadeInMs: 220, ...CALM },
    statement: { supportPop: 72, keyPop: 56, overshoot: 5,  wordFadeMs: 150, staggerMs: 45, ...CALM },
  },
  emphasis: { maxTier: 5, colour: "accent" },
  rhythm: { maxWordsPerLine: 3, holdEvery: 3 },
  colour: { primary: "#FFFFFF", secondary: "#9FB6C4", accentSource: "brand" },
  // Premium legibility = a crisp edge, NOT a drop shadow. A hard offset \shad reads like a
  // caption template; a clean tight outline with no shadow reads premium (and still separates
  // text from footage). Impact/Broadcast keep their heavier treatment.
  fx: { outlinePx: 3, shadowPx: 0, blur: 0 },
  // The recipe: Premium's complete presentation language — a motion designer's playbook.
  // Restraint, obvious hierarchy, sparse colour, calm confident motion. Every design
  // decision is declared here; the compiler only executes it.
  recipe: {
    attention: "singleFocus",                       // one focal word per beat; support recedes
    composition: ["editorial-stack", "single-hero", "statistic-card"],
    layout: "editorial",
    typography: ["heroHierarchy", "opticalTracking"],
    hierarchy: "obvious-modular-step",              // ≥1.5× step hero↔body
    readingRhythm: "calm",
    reveal: ["riseFade", "blurResolve"],            // slide-up + rack-focus resolve
    motion: ["drift", "hold"],                       // near-imperceptible push-in / stillness
    decoration: ["accentLine"],                     // one sparse drawn accent
    exit: ["dissolve"],                             // soft fade-out (exitFade)
    cta: "underlineReveal",                         // CTA underline draws on
    finalScene: "cinematicHold",                    // long, still, letter-spaced end
    timing: "calm",
  },
};
