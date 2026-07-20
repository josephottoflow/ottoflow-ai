/**
 * OttoFlow Creative OS — Motion token dictionary (Phase 3).
 *
 * The canonical, register-neutral motion values from the Motion System (Phase 6)
 * and Design Tokens (Phase 11 §2), expressed as data. Pure — no logic, no
 * rendering. Registers tune these within their ranges in a later cycle.
 *
 * Compatibility: `MotionSignature` intentionally mirrors the production `MotionSig`
 * shape the ASS compiler already consumes from `beat.motion`
 * (ffmpeg-pipeline/ass-captions.ts) — supportPop / keyPop / overshoot / wordFadeMs
 * / staggerMs / hold? / fadeInMs? — so a resolved signature drops in without any
 * compiler change. Nothing here is wired into a render; it is consumed only
 * through the engine + Render Profile mechanism.
 */

/** Narrative treatments the Motion Engine assigns signatures to. */
export type MotionTreatment =
  | "hook" | "stat" | "turn" | "question" | "cta" | "statement" | "hold";

/** A per-beat motion signature — identical shape to the production MotionSig. */
export interface MotionSignature {
  /** Entrance scale-start % for supporting words (100 = no movement). */
  supportPop: number;
  /** Entrance scale-start % for the emphasised/key word. */
  keyPop: number;
  /** Overshoot amount on settle (0 = none; motion decelerates into rest). */
  overshoot: number;
  /** Per-word fade duration (ms). */
  wordFadeMs: number;
  /** Stagger between words (ms). */
  staggerMs: number;
  /** True = still beat (fade only) — reserved stillness. */
  hold?: boolean;
  /** Optional entrance fade override (ms). */
  fadeInMs?: number;
}

/** Felt tempos (ms). Fast reads urgent, slow reads calm/confident (Motion §4). */
export const MOTION_DURATIONS = {
  quick: 130,
  base: 160,
  calm: 220,
  holdShort: 600,
  holdPeak: 1200,
} as const;

/** Stagger between words (ms) — energy from cascade, never from outrunning the read. */
export const MOTION_STAGGER = { tight: 24, base: 45, loose: 60 } as const;

/** Entrance scale-start % (lower = deeper dip = stronger presence). */
export const MOTION_POP = { strong: 48, medium: 72, gentle: 88, none: 100 } as const;

/** Overshoot amounts on settle. */
export const MOTION_OVERSHOOT = { strong: 9, medium: 5, subtle: 3, none: 0 } as const;

/**
 * Easing control points (cubic-bézier) — the canonical set. There is NO linear
 * curve, by Motion System law: everything decelerates into rest.
 */
export const MOTION_EASINGS = {
  standard: [0.2, 0, 0, 1], // decelerate into rest — the default
  soft: [0.16, 1, 0.3, 1], // expressive, gentle settle
  weighted: [0.65, 0, 0.35, 1], // mass in and out — transitions
  exit: [0.4, 0, 1, 1], // accelerate away — recede
} as const;

/** Budget invariants (Motion §6 / Tokens §2) — enforced by the engine helpers. */
export const MOTION_BUDGET = {
  primaryMax: 1, // one primary motion per moment
  emphasisPerBeat: 1, // one emphasis move per beat
  continuousMax: 0.6, // max fraction of a beat in motion; rest is mandatory
  holdEvery: 3, // reserved stillness cadence (a hold every ~3 statements)
  reservedStillness: true,
} as const;

export const MOTION_TREATMENTS: readonly MotionTreatment[] = [
  "hook", "stat", "turn", "question", "cta", "statement", "hold",
];

/**
 * The canonical treatment → signature table (register-neutral defaults), composed
 * from the primitive tokens above. Expresses the Motion System temperatures:
 * hook punchy/fast, stat detonates, turn snaps, question drifts slow, cta calm
 * confidence, statement gentle baseline, hold still.
 */
export const MOTION_SIGNATURE_TOKENS: Record<MotionTreatment, MotionSignature> = {
  hook: { supportPop: MOTION_POP.strong, keyPop: 42, overshoot: MOTION_OVERSHOOT.strong, wordFadeMs: MOTION_DURATIONS.quick, staggerMs: MOTION_STAGGER.tight },
  stat: { supportPop: 86, keyPop: 40, overshoot: 11, wordFadeMs: 150, staggerMs: 46 },
  turn: { supportPop: 64, keyPop: 56, overshoot: 7, wordFadeMs: 120, staggerMs: 20 },
  question: { supportPop: 86, keyPop: 82, overshoot: MOTION_OVERSHOOT.none, wordFadeMs: MOTION_DURATIONS.calm, staggerMs: MOTION_STAGGER.loose, fadeInMs: 240 },
  cta: { supportPop: 88, keyPop: 84, overshoot: MOTION_OVERSHOOT.subtle, wordFadeMs: 200, staggerMs: 55, fadeInMs: 220 },
  statement: { supportPop: MOTION_POP.medium, keyPop: 56, overshoot: MOTION_OVERSHOOT.medium, wordFadeMs: MOTION_DURATIONS.base, staggerMs: MOTION_STAGGER.base },
  hold: { supportPop: MOTION_POP.none, keyPop: 100, overshoot: MOTION_OVERSHOOT.none, wordFadeMs: 0, staggerMs: 0, hold: true },
};
