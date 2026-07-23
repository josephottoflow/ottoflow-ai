/**
 * OttoFlow · Impact — a presentation PHILOSOPHY, not a brand: big, uppercase,
 * punchy; high-energy attention with an active-word highlight and thick stroke.
 * Data only.
 *
 * Principles were extracted from the highest-retention viral/creator editing in the
 * industry and then made OttoFlow-native — no external visual identity is reproduced
 * or exposed. This is OttoFlow's own high-energy language.
 */
import type { StyleFamily } from "./types";

const PUNCH = { easeAccel: 0.5 };

export const IMPACT: StyleFamily = {
  id: "impact",
  group: "OttoFlow",
  label: "Impact",
  fonts: { display: "Sora", body: "Sora", mono: "IBM Plex Mono" },
  // Bigger, heavier, uppercase — the high-energy selling look. Body ≈ 108px.
  type: {
    hero:      { sizePct: 0.092, weight: 800, trackingPct: -0.01, leadingMult: 1.02, case: "upper" },
    display:   { sizePct: 0.080, weight: 800, trackingPct: -0.01, leadingMult: 1.04, case: "upper" },
    headline:  { sizePct: 0.070, weight: 800, trackingPct: 0,     leadingMult: 1.06, case: "upper" },
    section:   { sizePct: 0.062, weight: 700, trackingPct: 0,     leadingMult: 1.08, case: "upper" },
    body:      { sizePct: 0.056, weight: 700, trackingPct: 0.005, leadingMult: 1.10, case: "upper" },
    caption:   { sizePct: 0.052, weight: 700, trackingPct: 0.008, leadingMult: 1.12, case: "upper" },
    statistic: { sizePct: 0.100, weight: 800, trackingPct: -0.01, leadingMult: 1.02, case: "upper" },
    cta:       { sizePct: 0.072, weight: 800, trackingPct: 0,     leadingMult: 1.05, case: "upper" },
    brand:     { sizePct: 0.044, weight: 700, trackingPct: 0.03,  leadingMult: 1.15, case: "upper" },
    footer:    { sizePct: 0.034, weight: 600, trackingPct: 0.03,  leadingMult: 1.15, case: "upper" },
    micro:     { sizePct: 0.032, weight: 600, trackingPct: 0.04,  leadingMult: 1.15, case: "upper" },
  },
  roleByTreatment: {
    hook: "hero", stat: "statistic", turn: "headline",
    question: "headline", cta: "cta", statement: "body",
  },
  layoutByTreatment: {
    hook: "single-word-hero", stat: "number", turn: "centered",
    question: "centered", cta: "centered", statement: "centered",
  },
  // Composition Engine — Impact goes BIG and centred: heroes and CTAs command the frame
  // as a single hero; stats/questions/statements center-focus the punch word. No editorial
  // asymmetry — the energy is frontal and loud.
  compositionByTreatment: {
    // hook → center-focus (robust for multi-line hooks; emphasises the punch word).
    // single-hero reserved for genuinely one-line beats (CTA).
    hook: "center-focus",
    stat: "center-focus",
    turn: "center-focus",
    question: "center-focus",
    cta: "single-hero",
    statement: "center-focus",
  },
  motionByTreatment: {
    hook:      { supportPop: 40, keyPop: 36, overshoot: 12, wordFadeMs: 110, staggerMs: 22, ...PUNCH },
    stat:      { supportPop: 80, keyPop: 34, overshoot: 14, wordFadeMs: 130, staggerMs: 40, ...PUNCH },
    turn:      { supportPop: 58, keyPop: 50, overshoot: 9,  wordFadeMs: 110, staggerMs: 18, ...PUNCH },
    question:  { supportPop: 80, keyPop: 76, overshoot: 4,  wordFadeMs: 160, staggerMs: 46, ...PUNCH },
    cta:       { supportPop: 82, keyPop: 78, overshoot: 6,  wordFadeMs: 150, staggerMs: 44, ...PUNCH },
    statement: { supportPop: 66, keyPop: 50, overshoot: 8,  wordFadeMs: 130, staggerMs: 38, ...PUNCH },
  },
  emphasis: { maxTier: 6, colour: "accent" },
  rhythm: { maxWordsPerLine: 3, holdEvery: 4 },
  colour: { primary: "#FFD400", secondary: "#FFFFFF", accentSource: "brand" },
  fx: { outlinePx: 7, shadowPx: 5, blur: 1 },
  // The recipe: Impact's complete presentation language — big, frontal, punchy. Every
  // design decision declared here; the compiler only executes it.
  recipe: {
    attention: "isolate",                    // the punch word dominates, support recedes hard
    composition: ["single-hero", "center-focus"],
    layout: "hero",
    typography: ["heroHierarchy"],
    hierarchy: "obvious-modular-step",
    readingRhythm: "driving",
    reveal: ["pop", "scatter"],              // scale-in with overshoot (punchy entrance)
    motion: ["punch"],                       // hit on entry, then hold (no drift)
    decoration: ["accentLine"],
    exit: ["slide"],                         // hard slide-off
    cta: "boxReveal",
    finalScene: "hardCut",
    timing: "aggressive",
  },
};
