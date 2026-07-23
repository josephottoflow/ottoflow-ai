/**
 * OttoFlow · Signature — the FLAGSHIP house style: a balanced blend of the best of every
 * philosophy. Editorial hierarchy, a confident hero, a real metric card, sparse accent,
 * calm-but-alive motion. The safe, excellent default when no strong direction is chosen.
 * Data only.
 */
import type { StyleFamily } from "./types";

const BALANCED = { easeAccel: 0.5 };

export const SIGNATURE: StyleFamily = {
  id: "signature",
  group: "OttoFlow",
  label: "Signature",
  fonts: { display: "Plus Jakarta Sans", body: "Plus Jakarta Sans", mono: "IBM Plex Mono" },
  type: {
    hero:      { sizePct: 0.076, weight: 700, trackingPct: -0.018, leadingMult: 1.06, case: "sentence" },
    display:   { sizePct: 0.066, weight: 700, trackingPct: -0.012, leadingMult: 1.09, case: "sentence" },
    headline:  { sizePct: 0.058, weight: 700, trackingPct: -0.008, leadingMult: 1.12, case: "sentence" },
    section:   { sizePct: 0.054, weight: 600, trackingPct: 0,      leadingMult: 1.14, case: "sentence" },
    body:      { sizePct: 0.052, weight: 600, trackingPct: 0.004,  leadingMult: 1.18, case: "sentence" },
    caption:   { sizePct: 0.048, weight: 500, trackingPct: 0.006,  leadingMult: 1.20, case: "sentence" },
    statistic: { sizePct: 0.088, weight: 800, trackingPct: -0.01,  leadingMult: 1.04, case: "sentence" },
    cta:       { sizePct: 0.062, weight: 700, trackingPct: 0,      leadingMult: 1.10, case: "sentence" },
    brand:     { sizePct: 0.040, weight: 500, trackingPct: 0.02,   leadingMult: 1.20, case: "sentence" },
    footer:    { sizePct: 0.032, weight: 500, trackingPct: 0.02,   leadingMult: 1.20, case: "sentence" },
    micro:     { sizePct: 0.030, weight: 500, trackingPct: 0.03,   leadingMult: 1.20, case: "upper" },
  },
  roleByTreatment: {
    hook: "hero", stat: "statistic", turn: "display",
    question: "headline", cta: "cta", statement: "body",
  },
  layoutByTreatment: {
    hook: "editorial", stat: "number", turn: "centered",
    question: "centered", cta: "centered", statement: "centered",
  },
  // A blend: editorial hook, a real metric card for stats, dual-hero turn, centred rest.
  compositionByTreatment: {
    hook: "editorial-stack",
    stat: "statistic-card",
    turn: "dual-hero",
    question: "center-focus",
    cta: "single-hero",
    statement: "center-focus",
  },
  motionByTreatment: {
    hook:      { supportPop: 52, keyPop: 46, overshoot: 8,  wordFadeMs: 130, staggerMs: 26, ...BALANCED },
    stat:      { supportPop: 86, keyPop: 42, overshoot: 9,  wordFadeMs: 150, staggerMs: 46, ...BALANCED },
    turn:      { supportPop: 64, keyPop: 56, overshoot: 6,  wordFadeMs: 120, staggerMs: 22, ...BALANCED },
    question:  { supportPop: 86, keyPop: 82, overshoot: 0,  wordFadeMs: 210, staggerMs: 58, fadeInMs: 230, ...BALANCED },
    cta:       { supportPop: 88, keyPop: 84, overshoot: 3,  wordFadeMs: 200, staggerMs: 54, fadeInMs: 220, ...BALANCED },
    statement: { supportPop: 72, keyPop: 56, overshoot: 5,  wordFadeMs: 150, staggerMs: 44, ...BALANCED },
  },
  emphasis: { maxTier: 5, colour: "accent" },
  rhythm: { maxWordsPerLine: 3, holdEvery: 3 },
  colour: { primary: "#FFFFFF", secondary: "#9FB0BE", accentSource: "brand" },
  fx: { outlinePx: 5, shadowPx: 3, blur: 0 },
  recipe: {
    attention: "singleFocus",
    composition: ["editorial-stack", "statistic-card", "single-hero"],
    layout: "editorial",
    typography: ["heroHierarchy", "opticalTracking"],
    hierarchy: "obvious-modular-step",
    readingRhythm: "calm",
    reveal: ["riseFade", "blurResolve"],
    motion: ["drift", "hold"],
    decoration: ["accentLine"],
    exit: ["dissolve"],
    cta: "underlineReveal",
    finalScene: "cinematicHold",
    timing: "calm",
  },
};
