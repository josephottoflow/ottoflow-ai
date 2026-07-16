/**
 * OttoFlow · Cinematic — a presentation PHILOSOPHY: film-title grandeur. Wide letter-
 * spacing, poster compositions, slow rack-focus reveals, a stately drift. Text as a title
 * card, not a caption. Data only; principles generalised from film title sequences, no
 * external identity reproduced.
 */
import type { StyleFamily } from "./types";

const SLOW = { easeAccel: 0.4 };

export const CINEMATIC: StyleFamily = {
  id: "cinematic",
  group: "OttoFlow",
  label: "Cinematic",
  fonts: { display: "Plus Jakarta Sans", body: "Plus Jakarta Sans", mono: "IBM Plex Mono" },
  // Wide, elegant, title-like — positive tracking on display for the letterspaced look.
  type: {
    hero:      { sizePct: 0.068, weight: 600, trackingPct: 0.04,  leadingMult: 1.14, case: "upper" },
    display:   { sizePct: 0.060, weight: 600, trackingPct: 0.05,  leadingMult: 1.16, case: "upper" },
    headline:  { sizePct: 0.052, weight: 500, trackingPct: 0.03,  leadingMult: 1.18, case: "sentence" },
    section:   { sizePct: 0.048, weight: 500, trackingPct: 0.02,  leadingMult: 1.20, case: "sentence" },
    body:      { sizePct: 0.046, weight: 500, trackingPct: 0.02,  leadingMult: 1.24, case: "sentence" },
    caption:   { sizePct: 0.042, weight: 400, trackingPct: 0.04,  leadingMult: 1.26, case: "upper" },
    statistic: { sizePct: 0.080, weight: 700, trackingPct: 0,     leadingMult: 1.06, case: "sentence" },
    cta:       { sizePct: 0.054, weight: 600, trackingPct: 0.03,  leadingMult: 1.12, case: "upper" },
    brand:     { sizePct: 0.036, weight: 400, trackingPct: 0.08,  leadingMult: 1.24, case: "upper" },
    footer:    { sizePct: 0.030, weight: 400, trackingPct: 0.08,  leadingMult: 1.24, case: "upper" },
    micro:     { sizePct: 0.028, weight: 400, trackingPct: 0.10,  leadingMult: 1.24, case: "upper" },
  },
  roleByTreatment: {
    hook: "hero", stat: "statistic", turn: "display",
    question: "headline", cta: "cta", statement: "headline",
  },
  layoutByTreatment: {
    hook: "cinematic", stat: "number", turn: "cinematic",
    question: "centered", cta: "centered", statement: "centered",
  },
  compositionByTreatment: {
    hook: "poster",
    stat: "center-focus",
    turn: "poster",
    question: "center-focus",
    cta: "single-hero",
    statement: "center-focus",
  },
  motionByTreatment: {
    hook:      { supportPop: 82, keyPop: 78, overshoot: 0, wordFadeMs: 240, staggerMs: 44, fadeInMs: 300, ...SLOW },
    stat:      { supportPop: 88, keyPop: 66, overshoot: 0, wordFadeMs: 260, staggerMs: 56, fadeInMs: 300, ...SLOW },
    turn:      { supportPop: 82, keyPop: 78, overshoot: 0, wordFadeMs: 240, staggerMs: 42, fadeInMs: 300, ...SLOW },
    question:  { supportPop: 90, keyPop: 86, overshoot: 0, wordFadeMs: 280, staggerMs: 66, fadeInMs: 320, ...SLOW },
    cta:       { supportPop: 90, keyPop: 86, overshoot: 0, wordFadeMs: 260, staggerMs: 60, fadeInMs: 300, ...SLOW },
    statement: { supportPop: 86, keyPop: 80, overshoot: 0, wordFadeMs: 240, staggerMs: 52, fadeInMs: 280, ...SLOW },
  },
  emphasis: { maxTier: 4, colour: "accent" },
  rhythm: { maxWordsPerLine: 4, holdEvery: 2 },
  colour: { primary: "#F5F3EE", secondary: "#A69F92", accentSource: "brand" },
  fx: { outlinePx: 2, shadowPx: 5, blur: 0 },
  recipe: {
    attention: "singleFocus",
    composition: ["poster", "single-hero", "center-focus"],
    layout: "cinematic",
    typography: ["opticalTracking", "wideTracking"],
    hierarchy: "gentle-step",
    readingRhythm: "slow",
    reveal: ["maskWipe", "blurResolve"],   // signature: text revealed behind a clip edge
    motion: ["drift", "hold"],
    decoration: ["divider"],
    exit: ["dissolve"],
    cta: "underlineReveal",
    finalScene: "cinematicHold",
    timing: "slow",
  },
};
