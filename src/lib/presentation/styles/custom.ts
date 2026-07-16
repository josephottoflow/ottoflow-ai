/**
 * OttoFlow · Custom — a NEUTRAL BASE philosophy meant to be cloned. Safe, balanced
 * defaults across every axis; no strong stance. The starting point a user copies and
 * edits to author their own house style — proving "a philosophy is one config file".
 * Data only.
 */
import type { StyleFamily } from "./types";

const CALM = { easeAccel: 0.5 };

export const CUSTOM: StyleFamily = {
  id: "custom",
  group: "OttoFlow",
  label: "Custom",
  fonts: { display: "Plus Jakarta Sans", body: "Plus Jakarta Sans", mono: "IBM Plex Mono" },
  type: {
    hero:      { sizePct: 0.072, weight: 700, trackingPct: -0.012, leadingMult: 1.06, case: "sentence" },
    display:   { sizePct: 0.064, weight: 700, trackingPct: -0.008, leadingMult: 1.08, case: "sentence" },
    headline:  { sizePct: 0.056, weight: 600, trackingPct: 0,      leadingMult: 1.12, case: "sentence" },
    section:   { sizePct: 0.052, weight: 600, trackingPct: 0,      leadingMult: 1.14, case: "sentence" },
    body:      { sizePct: 0.050, weight: 600, trackingPct: 0.004,  leadingMult: 1.18, case: "sentence" },
    caption:   { sizePct: 0.046, weight: 500, trackingPct: 0.006,  leadingMult: 1.20, case: "sentence" },
    statistic: { sizePct: 0.084, weight: 800, trackingPct: -0.01,  leadingMult: 1.04, case: "sentence" },
    cta:       { sizePct: 0.060, weight: 700, trackingPct: 0,      leadingMult: 1.10, case: "sentence" },
    brand:     { sizePct: 0.040, weight: 500, trackingPct: 0.02,   leadingMult: 1.18, case: "sentence" },
    footer:    { sizePct: 0.032, weight: 500, trackingPct: 0.02,   leadingMult: 1.18, case: "sentence" },
    micro:     { sizePct: 0.030, weight: 500, trackingPct: 0.03,   leadingMult: 1.18, case: "upper" },
  },
  roleByTreatment: { hook: "hero", stat: "statistic", turn: "headline", question: "headline", cta: "cta", statement: "body" },
  layoutByTreatment: { hook: "centered", stat: "number", turn: "centered", question: "centered", cta: "centered", statement: "centered" },
  compositionByTreatment: {
    hook: "center-focus",
    stat: "center-focus",
    turn: "single-hero",
    question: "center-focus",
    cta: "single-hero",
    statement: "center-focus",
  },
  motionByTreatment: {
    hook:      { supportPop: 60, keyPop: 54, overshoot: 6, wordFadeMs: 140, staggerMs: 28, ...CALM },
    stat:      { supportPop: 84, keyPop: 48, overshoot: 7, wordFadeMs: 150, staggerMs: 44, ...CALM },
    turn:      { supportPop: 64, keyPop: 56, overshoot: 5, wordFadeMs: 130, staggerMs: 24, ...CALM },
    question:  { supportPop: 84, keyPop: 80, overshoot: 0, wordFadeMs: 200, staggerMs: 56, fadeInMs: 220, ...CALM },
    cta:       { supportPop: 86, keyPop: 82, overshoot: 3, wordFadeMs: 190, staggerMs: 52, fadeInMs: 210, ...CALM },
    statement: { supportPop: 72, keyPop: 56, overshoot: 4, wordFadeMs: 150, staggerMs: 44, ...CALM },
  },
  emphasis: { maxTier: 5, colour: "accent" },
  rhythm: { maxWordsPerLine: 3, holdEvery: 3 },
  colour: { primary: "#FFFFFF", secondary: "#9AA6B2", accentSource: "brand" },
  fx: { outlinePx: 4, shadowPx: 3, blur: 0 },
  recipe: {
    attention: "singleFocus", composition: ["center-focus", "single-hero"],
    layout: "centered", typography: ["heroHierarchy", "opticalTracking"], hierarchy: "obvious-modular-step",
    readingRhythm: "calm", reveal: ["riseFade"], motion: ["drift", "hold"],
    decoration: ["accentLine"], exit: ["dissolve"], cta: "underlineReveal",
    finalScene: "cinematicHold", timing: "calm",
  },
};
