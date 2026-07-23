/**
 * OttoFlow · Pulse — a presentation PHILOSOPHY: rhythmic, high-energy, music-video beat-
 * sync feel. Pop reveals, dynamic grids, dot accents, punchy holds. The most kinetic
 * OttoFlow language after Impact, but playful rather than hard-sell. Data only.
 */
import type { StyleFamily } from "./types";

const PUNCH = { easeAccel: 0.5 };

export const PULSE: StyleFamily = {
  id: "pulse",
  group: "OttoFlow",
  label: "Pulse",
  fonts: { display: "Sora", body: "Sora", mono: "IBM Plex Mono" },
  type: {
    hero:      { sizePct: 0.088, weight: 800, trackingPct: -0.01, leadingMult: 1.03, case: "upper" },
    display:   { sizePct: 0.076, weight: 800, trackingPct: -0.008, leadingMult: 1.05, case: "upper" },
    headline:  { sizePct: 0.066, weight: 700, trackingPct: 0,     leadingMult: 1.07, case: "upper" },
    section:   { sizePct: 0.058, weight: 700, trackingPct: 0,     leadingMult: 1.09, case: "upper" },
    body:      { sizePct: 0.054, weight: 700, trackingPct: 0.004, leadingMult: 1.10, case: "upper" },
    caption:   { sizePct: 0.048, weight: 600, trackingPct: 0.01,  leadingMult: 1.12, case: "upper" },
    statistic: { sizePct: 0.100, weight: 800, trackingPct: -0.01, leadingMult: 1.02, case: "upper" },
    cta:       { sizePct: 0.068, weight: 800, trackingPct: 0,     leadingMult: 1.05, case: "upper" },
    brand:     { sizePct: 0.042, weight: 700, trackingPct: 0.03,  leadingMult: 1.12, case: "upper" },
    footer:    { sizePct: 0.032, weight: 600, trackingPct: 0.03,  leadingMult: 1.12, case: "upper" },
    micro:     { sizePct: 0.030, weight: 600, trackingPct: 0.04,  leadingMult: 1.12, case: "upper" },
  },
  roleByTreatment: { hook: "hero", stat: "statistic", turn: "display", question: "headline", cta: "cta", statement: "body" },
  layoutByTreatment: { hook: "centered", stat: "number", turn: "centered", question: "centered", cta: "centered", statement: "centered" },
  compositionByTreatment: {
    hook: "center-focus",
    stat: "center-focus",
    turn: "dynamic-grid",
    question: "center-focus",
    cta: "single-hero",
    statement: "center-focus",
  },
  motionByTreatment: {
    hook:      { supportPop: 46, keyPop: 40, overshoot: 12, wordFadeMs: 100, staggerMs: 18, ...PUNCH },
    stat:      { supportPop: 78, keyPop: 36, overshoot: 14, wordFadeMs: 120, staggerMs: 34, ...PUNCH },
    turn:      { supportPop: 54, keyPop: 48, overshoot: 10, wordFadeMs: 100, staggerMs: 16, ...PUNCH },
    question:  { supportPop: 80, keyPop: 74, overshoot: 5,  wordFadeMs: 150, staggerMs: 42, ...PUNCH },
    cta:       { supportPop: 82, keyPop: 78, overshoot: 7,  wordFadeMs: 140, staggerMs: 40, ...PUNCH },
    statement: { supportPop: 64, keyPop: 48, overshoot: 9,  wordFadeMs: 120, staggerMs: 34, ...PUNCH },
  },
  emphasis: { maxTier: 6, colour: "accent" },
  rhythm: { maxWordsPerLine: 3, holdEvery: 5 },
  colour: { primary: "#FFFFFF", secondary: "#C0C0C0", accentSource: "brand" },
  fx: { outlinePx: 6, shadowPx: 4, blur: 1 },
  recipe: {
    attention: "isolate", composition: ["center-focus", "dynamic-grid", "single-hero"],
    layout: "hero", typography: ["heroHierarchy"], hierarchy: "obvious-modular-step",
    readingRhythm: "driving", reveal: ["pop"], motion: ["hold"],
    decoration: ["dot", "accentLine"], exit: ["slide"], cta: "boxReveal",
    finalScene: "hardCut", timing: "aggressive",
  },
};
