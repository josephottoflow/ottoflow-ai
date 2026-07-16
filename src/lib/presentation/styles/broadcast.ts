/**
 * OttoFlow · Broadcast — a presentation PHILOSOPHY: TV news / sports-graphics authority.
 * Anchored lower-thirds, corner labels, sidebar rails, crisp slide-ins, stable holds.
 * Structured and confident — information you trust. Data only; principles generalised from
 * broadcast/sports graphics, no external identity reproduced.
 */
import type { StyleFamily } from "./types";

const STEADY = { easeAccel: 0.7 };

export const BROADCAST: StyleFamily = {
  id: "broadcast",
  group: "OttoFlow",
  label: "Broadcast",
  fonts: { display: "Sora", body: "Sora", mono: "IBM Plex Mono" },
  type: {
    hero:      { sizePct: 0.070, weight: 700, trackingPct: 0,      leadingMult: 1.05, case: "sentence" },
    display:   { sizePct: 0.062, weight: 700, trackingPct: 0,      leadingMult: 1.08, case: "sentence" },
    headline:  { sizePct: 0.056, weight: 700, trackingPct: 0,      leadingMult: 1.10, case: "sentence" },
    section:   { sizePct: 0.050, weight: 600, trackingPct: 0.004,  leadingMult: 1.12, case: "sentence" },
    body:      { sizePct: 0.048, weight: 600, trackingPct: 0.006,  leadingMult: 1.15, case: "sentence" },
    caption:   { sizePct: 0.042, weight: 500, trackingPct: 0.02,   leadingMult: 1.18, case: "upper" },
    statistic: { sizePct: 0.092, weight: 800, trackingPct: -0.005, leadingMult: 1.02, case: "sentence" },
    cta:       { sizePct: 0.058, weight: 700, trackingPct: 0,      leadingMult: 1.08, case: "sentence" },
    brand:     { sizePct: 0.038, weight: 600, trackingPct: 0.04,   leadingMult: 1.18, case: "upper" },
    footer:    { sizePct: 0.030, weight: 500, trackingPct: 0.04,   leadingMult: 1.18, case: "upper" },
    micro:     { sizePct: 0.028, weight: 500, trackingPct: 0.05,   leadingMult: 1.18, case: "upper" },
  },
  roleByTreatment: {
    hook: "hero", stat: "statistic", turn: "headline",
    question: "headline", cta: "cta", statement: "body",
  },
  layoutByTreatment: {
    hook: "side", stat: "number", turn: "side",
    question: "centered", cta: "centered", statement: "side",
  },
  // Composition Engine — Broadcast anchors information: lower-thirds for hook/statement,
  // a corner label for the turn, center-focus for stat/question, single-hero CTA.
  compositionByTreatment: {
    hook: "lower-third",
    stat: "center-focus",
    turn: "corner-label",
    question: "center-focus",
    cta: "single-hero",
    statement: "lower-third",
  },
  motionByTreatment: {
    hook:      { supportPop: 70, keyPop: 64, overshoot: 2, wordFadeMs: 120, staggerMs: 24, ...STEADY },
    stat:      { supportPop: 82, keyPop: 44, overshoot: 3, wordFadeMs: 140, staggerMs: 40, ...STEADY },
    turn:      { supportPop: 70, keyPop: 62, overshoot: 2, wordFadeMs: 120, staggerMs: 22, ...STEADY },
    question:  { supportPop: 84, keyPop: 80, overshoot: 0, wordFadeMs: 180, staggerMs: 50, fadeInMs: 200, ...STEADY },
    cta:       { supportPop: 84, keyPop: 80, overshoot: 2, wordFadeMs: 170, staggerMs: 48, fadeInMs: 190, ...STEADY },
    statement: { supportPop: 76, keyPop: 62, overshoot: 2, wordFadeMs: 130, staggerMs: 40, ...STEADY },
  },
  emphasis: { maxTier: 5, colour: "accent" },
  rhythm: { maxWordsPerLine: 4, holdEvery: 3 },
  colour: { primary: "#FFFFFF", secondary: "#9BB0C9", accentSource: "brand" },
  fx: { outlinePx: 4, shadowPx: 3, blur: 0 },
  // The recipe: Broadcast's complete presentation language — anchored, crisp, stable.
  recipe: {
    attention: "singleFocus",
    composition: ["lower-third", "corner-label", "center-focus"],
    layout: "lower-third",
    typography: ["heroHierarchy", "opticalTracking"],
    hierarchy: "obvious-modular-step",
    readingRhythm: "steady",
    reveal: ["slide"],
    motion: ["hold"],
    decoration: ["tick", "underline", "cornerBracket"],
    exit: ["slide"],
    cta: "boxReveal",
    finalScene: "hardCut",
    timing: "steady",
  },
};
