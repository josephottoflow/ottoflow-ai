/**
 * OttoFlow · Momentum — a presentation PHILOSOPHY: forward-driving energy. Slide-ins,
 * timelines, splits — always moving toward the next beat. Kinetic but controlled (between
 * Impact's punch and Broadcast's order). Data only; principles generalised from kinetic
 * commercial editing.
 */
import type { StyleFamily } from "./types";

const DRIVE = { easeAccel: 0.6 };

export const MOMENTUM: StyleFamily = {
  id: "momentum",
  group: "OttoFlow",
  label: "Momentum",
  fonts: { display: "Sora", body: "Sora", mono: "IBM Plex Mono" },
  type: {
    hero:      { sizePct: 0.082, weight: 800, trackingPct: -0.012, leadingMult: 1.04, case: "sentence" },
    display:   { sizePct: 0.072, weight: 800, trackingPct: -0.008, leadingMult: 1.06, case: "sentence" },
    headline:  { sizePct: 0.062, weight: 700, trackingPct: -0.004, leadingMult: 1.08, case: "sentence" },
    section:   { sizePct: 0.056, weight: 700, trackingPct: 0,      leadingMult: 1.10, case: "sentence" },
    body:      { sizePct: 0.052, weight: 600, trackingPct: 0.002,  leadingMult: 1.12, case: "sentence" },
    caption:   { sizePct: 0.046, weight: 600, trackingPct: 0.01,   leadingMult: 1.14, case: "upper" },
    statistic: { sizePct: 0.096, weight: 800, trackingPct: -0.01,  leadingMult: 1.02, case: "sentence" },
    cta:       { sizePct: 0.064, weight: 800, trackingPct: 0,      leadingMult: 1.06, case: "sentence" },
    brand:     { sizePct: 0.040, weight: 700, trackingPct: 0.03,   leadingMult: 1.14, case: "upper" },
    footer:    { sizePct: 0.032, weight: 600, trackingPct: 0.03,   leadingMult: 1.14, case: "upper" },
    micro:     { sizePct: 0.030, weight: 600, trackingPct: 0.04,   leadingMult: 1.14, case: "upper" },
  },
  roleByTreatment: { hook: "hero", stat: "statistic", turn: "display", question: "headline", cta: "cta", statement: "body" },
  layoutByTreatment: { hook: "centered", stat: "number", turn: "split", question: "centered", cta: "centered", statement: "centered" },
  compositionByTreatment: {
    hook: "single-hero",
    stat: "center-focus",
    turn: "split",
    question: "center-focus",
    cta: "single-hero",
    statement: "timeline",
  },
  motionByTreatment: {
    hook:      { supportPop: 60, keyPop: 54, overshoot: 6, wordFadeMs: 110, staggerMs: 20, ...DRIVE },
    stat:      { supportPop: 82, keyPop: 42, overshoot: 8, wordFadeMs: 130, staggerMs: 38, ...DRIVE },
    turn:      { supportPop: 62, keyPop: 54, overshoot: 5, wordFadeMs: 110, staggerMs: 18, ...DRIVE },
    question:  { supportPop: 82, keyPop: 78, overshoot: 2, wordFadeMs: 160, staggerMs: 46, fadeInMs: 190, ...DRIVE },
    cta:       { supportPop: 84, keyPop: 80, overshoot: 4, wordFadeMs: 150, staggerMs: 44, fadeInMs: 180, ...DRIVE },
    statement: { supportPop: 70, keyPop: 56, overshoot: 4, wordFadeMs: 120, staggerMs: 36, ...DRIVE },
  },
  emphasis: { maxTier: 5, colour: "accent" },
  rhythm: { maxWordsPerLine: 3, holdEvery: 4 },
  colour: { primary: "#FFFFFF", secondary: "#A0AEC0", accentSource: "brand" },
  fx: { outlinePx: 5, shadowPx: 3, blur: 0 },
  recipe: {
    attention: "isolate", composition: ["single-hero", "split", "timeline"],
    layout: "hero", typography: ["heroHierarchy"], hierarchy: "obvious-modular-step",
    readingRhythm: "driving", reveal: ["slide"], motion: ["hold"],
    decoration: ["accentLine", "leader"], exit: ["slide"], cta: "boxReveal",
    finalScene: "hardCut", timing: "aggressive",
  },
};
