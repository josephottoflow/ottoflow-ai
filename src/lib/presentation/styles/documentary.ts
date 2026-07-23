/**
 * OttoFlow · Documentary — a presentation PHILOSOPHY: cinematic, unhurried, observational.
 * Restrained lower-thirds, floating captions in negative space, quote cards, slow drift.
 * Lets the footage breathe; text is a quiet narrator. Data only; principles generalised
 * from documentary/film graphics, no external identity reproduced.
 */
import type { StyleFamily } from "./types";

const SLOW = { easeAccel: 0.4 };

export const DOCUMENTARY: StyleFamily = {
  id: "documentary",
  group: "OttoFlow",
  label: "Documentary",
  fonts: { display: "Plus Jakarta Sans", body: "Plus Jakarta Sans", mono: "IBM Plex Mono" },
  type: {
    hero:      { sizePct: 0.062, weight: 600, trackingPct: -0.008, leadingMult: 1.12, case: "sentence" },
    display:   { sizePct: 0.056, weight: 600, trackingPct: -0.004, leadingMult: 1.15, case: "sentence" },
    headline:  { sizePct: 0.052, weight: 600, trackingPct: 0,      leadingMult: 1.18, case: "sentence" },
    section:   { sizePct: 0.048, weight: 500, trackingPct: 0.004,  leadingMult: 1.20, case: "sentence" },
    body:      { sizePct: 0.046, weight: 500, trackingPct: 0.006,  leadingMult: 1.24, case: "sentence" },
    caption:   { sizePct: 0.042, weight: 500, trackingPct: 0.01,   leadingMult: 1.26, case: "sentence" },
    statistic: { sizePct: 0.076, weight: 700, trackingPct: -0.006, leadingMult: 1.06, case: "sentence" },
    cta:       { sizePct: 0.054, weight: 600, trackingPct: 0,      leadingMult: 1.12, case: "sentence" },
    brand:     { sizePct: 0.036, weight: 500, trackingPct: 0.04,   leadingMult: 1.22, case: "upper" },
    footer:    { sizePct: 0.030, weight: 400, trackingPct: 0.04,   leadingMult: 1.22, case: "upper" },
    micro:     { sizePct: 0.028, weight: 400, trackingPct: 0.05,   leadingMult: 1.22, case: "upper" },
  },
  roleByTreatment: {
    hook: "hero", stat: "statistic", turn: "display",
    question: "headline", cta: "cta", statement: "body",
  },
  layoutByTreatment: {
    hook: "side", stat: "number", turn: "quote",
    question: "centered", cta: "centered", statement: "side",
  },
  compositionByTreatment: {
    hook: "lower-third",
    stat: "center-focus",
    turn: "quote-card",
    question: "center-focus",
    cta: "single-hero",
    statement: "floating-caption",
  },
  motionByTreatment: {
    hook:      { supportPop: 78, keyPop: 72, overshoot: 0, wordFadeMs: 200, staggerMs: 36, fadeInMs: 260, ...SLOW },
    stat:      { supportPop: 86, keyPop: 60, overshoot: 0, wordFadeMs: 220, staggerMs: 50, fadeInMs: 260, ...SLOW },
    turn:      { supportPop: 80, keyPop: 74, overshoot: 0, wordFadeMs: 200, staggerMs: 34, fadeInMs: 260, ...SLOW },
    question:  { supportPop: 88, keyPop: 84, overshoot: 0, wordFadeMs: 240, staggerMs: 64, fadeInMs: 280, ...SLOW },
    cta:       { supportPop: 88, keyPop: 84, overshoot: 0, wordFadeMs: 220, staggerMs: 58, fadeInMs: 260, ...SLOW },
    statement: { supportPop: 82, keyPop: 72, overshoot: 0, wordFadeMs: 200, staggerMs: 48, fadeInMs: 240, ...SLOW },
  },
  emphasis: { maxTier: 4, colour: "accent" },
  rhythm: { maxWordsPerLine: 5, holdEvery: 2 },
  colour: { primary: "#F2F2F0", secondary: "#9A9A96", accentSource: "brand" },
  fx: { outlinePx: 3, shadowPx: 4, blur: 0 },
  recipe: {
    attention: "singleFocus",
    composition: ["lower-third", "floating-caption", "quote-card"],
    layout: "cinematic",
    typography: ["opticalTracking"],
    hierarchy: "gentle-step",
    readingRhythm: "slow",
    reveal: ["blurResolve"],
    motion: ["drift", "hold"],
    decoration: ["divider"],
    exit: ["dissolve"],
    cta: "underlineReveal",
    finalScene: "cinematicHold",
    timing: "slow",
  },
};
