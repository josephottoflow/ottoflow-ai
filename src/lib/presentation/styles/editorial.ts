/**
 * OttoFlow · Editorial — a presentation PHILOSOPHY: journalistic/magazine restraint.
 * Where Premium centres and Impact shouts, Editorial composes ASYMMETRICALLY — left-
 * anchored stacks, offset blocks, magazine framing, generous negative space. Confident,
 * literate, unhurried. Data only; principles generalised from editorial/magazine design,
 * no external identity reproduced.
 */
import type { StyleFamily } from "./types";

const CALM = { easeAccel: 0.5 };

export const EDITORIAL: StyleFamily = {
  id: "editorial",
  group: "OttoFlow",
  label: "Editorial",
  fonts: { display: "Plus Jakarta Sans", body: "Plus Jakarta Sans", mono: "IBM Plex Mono" },
  // Slightly smaller, more text-like than Premium; strong kicker/headline contrast.
  type: {
    hero:      { sizePct: 0.072, weight: 700, trackingPct: -0.018, leadingMult: 1.06, case: "sentence" },
    display:   { sizePct: 0.064, weight: 700, trackingPct: -0.012, leadingMult: 1.10, case: "sentence" },
    headline:  { sizePct: 0.058, weight: 700, trackingPct: -0.008, leadingMult: 1.14, case: "sentence" },
    section:   { sizePct: 0.052, weight: 600, trackingPct: 0,      leadingMult: 1.16, case: "sentence" },
    body:      { sizePct: 0.050, weight: 600, trackingPct: 0.004,  leadingMult: 1.20, case: "sentence" },
    caption:   { sizePct: 0.046, weight: 500, trackingPct: 0.006,  leadingMult: 1.22, case: "sentence" },
    statistic: { sizePct: 0.082, weight: 800, trackingPct: -0.01,  leadingMult: 1.05, case: "sentence" },
    cta:       { sizePct: 0.058, weight: 700, trackingPct: 0,      leadingMult: 1.10, case: "sentence" },
    brand:     { sizePct: 0.038, weight: 500, trackingPct: 0.03,   leadingMult: 1.20, case: "upper" },
    footer:    { sizePct: 0.030, weight: 500, trackingPct: 0.03,   leadingMult: 1.20, case: "upper" },
    micro:     { sizePct: 0.028, weight: 500, trackingPct: 0.04,   leadingMult: 1.20, case: "upper" },
  },
  roleByTreatment: {
    hook: "hero", stat: "statistic", turn: "display",
    question: "headline", cta: "cta", statement: "body",
  },
  layoutByTreatment: {
    hook: "editorial", stat: "number", turn: "editorial",
    question: "centered", cta: "centered", statement: "offset",
  },
  // Composition Engine — Editorial's asymmetry: kicker/headline stacks left-anchored,
  // statements offset, the "turn" gets a full magazine-cover frame.
  compositionByTreatment: {
    hook: "editorial-stack",
    stat: "center-focus",
    turn: "magazine-cover",
    question: "center-focus",
    cta: "single-hero",
    statement: "offset-left",
  },
  motionByTreatment: {
    hook:      { supportPop: 60, keyPop: 52, overshoot: 5,  wordFadeMs: 150, staggerMs: 30, ...CALM },
    stat:      { supportPop: 84, keyPop: 40, overshoot: 6,  wordFadeMs: 160, staggerMs: 46, ...CALM },
    turn:      { supportPop: 66, keyPop: 58, overshoot: 4,  wordFadeMs: 140, staggerMs: 26, ...CALM },
    question:  { supportPop: 84, keyPop: 80, overshoot: 0,  wordFadeMs: 220, staggerMs: 60, fadeInMs: 240, ...CALM },
    cta:       { supportPop: 86, keyPop: 82, overshoot: 2,  wordFadeMs: 200, staggerMs: 55, fadeInMs: 220, ...CALM },
    statement: { supportPop: 74, keyPop: 58, overshoot: 3,  wordFadeMs: 150, staggerMs: 45, ...CALM },
  },
  emphasis: { maxTier: 5, colour: "accent" },
  rhythm: { maxWordsPerLine: 4, holdEvery: 3 },
  colour: { primary: "#FFFFFF", secondary: "#A9AFB8", accentSource: "brand" },
  fx: { outlinePx: 4, shadowPx: 2, blur: 0 },
  // The recipe: Editorial's complete presentation language — asymmetric, literate, calm.
  recipe: {
    attention: "singleFocus",
    composition: ["editorial-stack", "offset-left", "magazine-cover"],
    layout: "editorial",
    typography: ["heroHierarchy", "opticalTracking"],
    hierarchy: "obvious-modular-step",
    readingRhythm: "calm",
    reveal: ["riseFade", "blurResolve"],
    motion: ["drift", "hold"],
    decoration: ["accentLine", "cornerBracket"],
    exit: ["dissolve"],
    cta: "underlineReveal",
    finalScene: "cinematicHold",
    timing: "calm",
  },
};
