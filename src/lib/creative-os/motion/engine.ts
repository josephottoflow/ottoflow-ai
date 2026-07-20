/**
 * OttoFlow Creative OS — Motion Engine (Phase 3).
 *
 * A pure, deterministic resolver: narrative treatment → a concrete motion
 * signature (the production MotionSig shape), driven entirely by the Phase 3
 * motion token dictionary. This is the token-driven counterpart to the hardcoded
 * MOTION_SIGNATURES table in the ASS compiler — sourced from ONE canonical set so
 * registers can tune motion on a shared foundation later.
 *
 * It also exposes the Motion System's budget as enforceable predicates (one
 * primary motion, one emphasis/beat, bounded continuous motion) and the
 * reserved-stillness cadence. Output drops into `beat.motion` with no compiler
 * change; consumed only via the opt-in pass + Render Profile mechanism.
 *
 * Purity: no clock, no I/O, no globals.
 */
import {
  MOTION_SIGNATURE_TOKENS,
  MOTION_EASINGS,
  MOTION_BUDGET,
  type MotionSignature,
  type MotionTreatment,
} from "../tokens/motion";

const KNOWN: readonly MotionTreatment[] = [
  "hook", "stat", "turn", "question", "cta", "statement", "hold",
];

/** Resolve a treatment to its motion signature. Unknown → the statement baseline.
 * Returns a fresh object so callers can never mutate the token table. */
export function resolveMotionSig(treatment?: string): MotionSignature {
  const key = (treatment && (KNOWN as string[]).includes(treatment)
    ? treatment
    : "statement") as MotionTreatment;
  return { ...MOTION_SIGNATURE_TOKENS[key] };
}

/** Resolve a named easing to its cubic-bezier control points. Unknown → standard
 * (decelerate into rest). Never returns a linear curve. */
export function resolveEasing(name?: string): readonly number[] {
  const table = MOTION_EASINGS as Record<string, readonly number[]>;
  return name && table[name] ? table[name] : MOTION_EASINGS.standard;
}

/** Current motion usage within a single moment/beat. */
export interface MotionUsage {
  /** Number of PRIMARY motions active simultaneously. */
  primaryMotions: number;
  /** Number of emphasis moves in the beat. */
  emphasisMoves: number;
  /** Fraction of the beat spent in motion (0..1). */
  continuousRatio: number;
}

/** True when usage respects the Motion System budget invariants. Pure predicate;
 * the engine never mutates — enforcement is the caller's decision. */
export function withinMotionBudget(usage: MotionUsage): boolean {
  return (
    usage.primaryMotions <= MOTION_BUDGET.primaryMax &&
    usage.emphasisMoves <= MOTION_BUDGET.emphasisPerBeat &&
    usage.continuousRatio <= MOTION_BUDGET.continuousMax
  );
}

/** Reserved-stillness cadence: whether the beat at `index` should HOLD (be still)
 * so the surrounding moving beats own the frame. Deterministic; mirrors the
 * "a hold every ~holdEvery beats" sequencing rule (Motion §5/§6). */
export function isHoldBeat(index: number): boolean {
  const n = MOTION_BUDGET.holdEvery;
  return n > 0 && index % n === n - 1;
}
