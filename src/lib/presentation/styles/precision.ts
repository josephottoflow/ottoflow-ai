/**
 * OttoFlow · Precision — a presentation PHILOSOPHY: technical, exact, data-forward.
 * Feature callouts, comparisons, grids, tight tracking, crisp reveals. For specs, numbers,
 * engineering confidence. Data only; principles generalised from technical/data design.
 */
import type { StyleFamily } from "./types";

const CRISP = { easeAccel: 0.6 };

export const PRECISION: StyleFamily = {
  id: "precision",
  group: "OttoFlow",
  label: "Precision",
  fonts: { display: "Sora", body: "Sora", mono: "IBM Plex Mono" },
  type: {
    hero:      { sizePct: 0.068, weight: 700, trackingPct: -0.012, leadingMult: 1.06, case: "sentence" },
    display:   { sizePct: 0.060, weight: 700, trackingPct: -0.008, leadingMult: 1.08, case: "sentence" },
    headline:  { sizePct: 0.054, weight: 600, trackingPct: -0.004, leadingMult: 1.12, case: "sentence" },
    section:   { sizePct: 0.050, weight: 600, trackingPct: 0,      leadingMult: 1.14, case: "sentence" },
    body:      { sizePct: 0.048, weight: 500, trackingPct: 0.002,  leadingMult: 1.16, case: "sentence" },
    caption:   { sizePct: 0.042, weight: 500, trackingPct: 0.02,   leadingMult: 1.18, case: "upper" },
    statistic: { sizePct: 0.090, weight: 800, trackingPct: -0.01,  leadingMult: 1.02, case: "sentence" },
    cta:       { sizePct: 0.058, weight: 700, trackingPct: 0,      leadingMult: 1.08, case: "sentence" },
    brand:     { sizePct: 0.038, weight: 600, trackingPct: 0.04,   leadingMult: 1.16, case: "upper" },
    footer:    { sizePct: 0.030, weight: 500, trackingPct: 0.04,   leadingMult: 1.16, case: "upper" },
    micro:     { sizePct: 0.028, weight: 500, trackingPct: 0.05,   leadingMult: 1.16, case: "upper" },
  },
  roleByTreatment: { hook: "hero", stat: "statistic", turn: "headline", question: "headline", cta: "cta", statement: "body" },
  layoutByTreatment: { hook: "centered", stat: "number", turn: "split", question: "centered", cta: "centered", statement: "centered" },
  compositionByTreatment: {
    hook: "feature-callout",
    stat: "statistic-card",
    turn: "comparison",
    question: "center-focus",
    cta: "single-hero",
    statement: "center-focus",
  },
  motionByTreatment: {
    hook:      { supportPop: 74, keyPop: 68, overshoot: 2, wordFadeMs: 120, staggerMs: 24, ...CRISP },
    stat:      { supportPop: 84, keyPop: 44, overshoot: 3, wordFadeMs: 140, staggerMs: 42, ...CRISP },
    turn:      { supportPop: 72, keyPop: 64, overshoot: 2, wordFadeMs: 120, staggerMs: 22, ...CRISP },
    question:  { supportPop: 84, keyPop: 80, overshoot: 0, wordFadeMs: 180, staggerMs: 50, fadeInMs: 200, ...CRISP },
    cta:       { supportPop: 84, keyPop: 80, overshoot: 2, wordFadeMs: 160, staggerMs: 46, fadeInMs: 190, ...CRISP },
    statement: { supportPop: 76, keyPop: 62, overshoot: 2, wordFadeMs: 130, staggerMs: 40, ...CRISP },
  },
  emphasis: { maxTier: 5, colour: "accent" },
  rhythm: { maxWordsPerLine: 4, holdEvery: 3 },
  colour: { primary: "#FFFFFF", secondary: "#8FA3B8", accentSource: "brand" },
  fx: { outlinePx: 4, shadowPx: 2, blur: 0 },
  recipe: {
    attention: "singleFocus", composition: ["feature-callout", "comparison", "statistic-card"],
    layout: "grid", typography: ["heroHierarchy", "opticalTracking"], hierarchy: "obvious-modular-step",
    readingRhythm: "steady", reveal: ["riseFade"], motion: ["hold"],
    decoration: ["cornerBracket", "leader"], exit: ["dissolve"], cta: "boxReveal",
    finalScene: "hardCut", timing: "steady",
  },
};
