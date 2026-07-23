/**
 * OttoFlow · Minimal — a presentation PHILOSOPHY: extreme restraint. One idea, centred,
 * no decoration, the quietest possible accent. Confidence through emptiness. The anti-
 * subtitle: nothing on screen that isn't load-bearing. Data only.
 */
import type { StyleFamily } from "./types";

const CALM = { easeAccel: 0.5 };

export const MINIMAL: StyleFamily = {
  id: "minimal",
  group: "OttoFlow",
  label: "Minimal",
  fonts: { display: "Plus Jakarta Sans", body: "Plus Jakarta Sans", mono: "IBM Plex Mono" },
  type: {
    hero:      { sizePct: 0.066, weight: 600, trackingPct: -0.01, leadingMult: 1.10, case: "sentence" },
    display:   { sizePct: 0.060, weight: 600, trackingPct: -0.006, leadingMult: 1.12, case: "sentence" },
    headline:  { sizePct: 0.054, weight: 500, trackingPct: 0,     leadingMult: 1.15, case: "sentence" },
    section:   { sizePct: 0.050, weight: 500, trackingPct: 0.002, leadingMult: 1.16, case: "sentence" },
    body:      { sizePct: 0.048, weight: 500, trackingPct: 0.004, leadingMult: 1.20, case: "sentence" },
    caption:   { sizePct: 0.044, weight: 400, trackingPct: 0.008, leadingMult: 1.22, case: "sentence" },
    statistic: { sizePct: 0.078, weight: 700, trackingPct: -0.008, leadingMult: 1.05, case: "sentence" },
    cta:       { sizePct: 0.056, weight: 600, trackingPct: 0,     leadingMult: 1.10, case: "sentence" },
    brand:     { sizePct: 0.036, weight: 400, trackingPct: 0.03,  leadingMult: 1.20, case: "sentence" },
    footer:    { sizePct: 0.030, weight: 400, trackingPct: 0.03,  leadingMult: 1.20, case: "sentence" },
    micro:     { sizePct: 0.028, weight: 400, trackingPct: 0.04,  leadingMult: 1.20, case: "upper" },
  },
  roleByTreatment: {
    hook: "hero", stat: "statistic", turn: "headline",
    question: "headline", cta: "cta", statement: "body",
  },
  layoutByTreatment: {
    hook: "centered", stat: "number", turn: "centered",
    question: "centered", cta: "centered", statement: "centered",
  },
  // Everything centred and singular — the composition IS the restraint.
  compositionByTreatment: {
    hook: "single-hero",
    stat: "center-focus",
    turn: "center-focus",
    question: "center-focus",
    cta: "single-hero",
    statement: "center-focus",
  },
  motionByTreatment: {
    hook:      { supportPop: 88, keyPop: 84, overshoot: 0, wordFadeMs: 220, staggerMs: 40, fadeInMs: 260, ...CALM },
    stat:      { supportPop: 90, keyPop: 70, overshoot: 0, wordFadeMs: 240, staggerMs: 52, fadeInMs: 260, ...CALM },
    turn:      { supportPop: 88, keyPop: 84, overshoot: 0, wordFadeMs: 220, staggerMs: 40, fadeInMs: 260, ...CALM },
    question:  { supportPop: 90, keyPop: 86, overshoot: 0, wordFadeMs: 240, staggerMs: 60, fadeInMs: 280, ...CALM },
    cta:       { supportPop: 90, keyPop: 86, overshoot: 0, wordFadeMs: 230, staggerMs: 58, fadeInMs: 260, ...CALM },
    statement: { supportPop: 88, keyPop: 82, overshoot: 0, wordFadeMs: 220, staggerMs: 50, fadeInMs: 240, ...CALM },
  },
  emphasis: { maxTier: 3, colour: "accent" },
  rhythm: { maxWordsPerLine: 4, holdEvery: 2 },
  colour: { primary: "#FFFFFF", secondary: "#8A8A8A", accentSource: "brand" },
  fx: { outlinePx: 2, shadowPx: 1, blur: 0 },
  recipe: {
    attention: "singleFocus",
    composition: ["single-hero", "center-focus"],
    layout: "centered",
    typography: ["opticalTracking"],
    hierarchy: "gentle-step",
    readingRhythm: "calm",
    reveal: ["riseFade"],
    motion: ["hold"],
    decoration: [],                 // NONE — the defining restraint
    exit: ["dissolve"],
    cta: "underlineReveal",
    finalScene: "cinematicHold",
    timing: "minimal",
  },
};
