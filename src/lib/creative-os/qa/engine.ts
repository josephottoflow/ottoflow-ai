/**
 * OttoFlow Creative OS — QA Engine (Phase 7).
 *
 * The token-driven evaluation: score a candidate across the ten Design-QA
 * dimensions, combine hard gates with a register-weighted quality score, and emit
 * an advisory verdict — Reject / Revise / Pass. It builds on the Phase 1
 * report-only scaffold (AdvisoryQaReport): the report's `blocking` is the literal
 * `false` ALWAYS. This engine EVALUATES ONLY — it never blocks a render, and no
 * render path depends on its result. A "reject" verdict is a label, not an
 * enforcement.
 *
 * Purity: no clock, no I/O, no globals.
 */
import type { AdvisoryDimension, AdvisoryQaReport } from "../qa-report";
import {
  QA_DIMENSIONS,
  QA_WEIGHTS,
  QA_DEFAULT_THRESHOLD,
  type QaDimension,
  type QaVerdict,
} from "../tokens/qa";

/** One dimension's signal: did its hard gate pass, and its 0..1 quality score. */
export interface DimensionSignal {
  gatePass: boolean;
  /** 0..1 quality above the gate. */
  score: number;
}

/** A candidate to evaluate. Absent dimensions are treated as a clean pass. */
export interface QaCandidate {
  profile: string;
  dimensions: Partial<Record<QaDimension, DimensionSignal>>;
}

/** The advisory evaluation — the Phase 1 report shape, plus a verdict + score. */
export interface QaEvaluation extends AdvisoryQaReport {
  verdict: QaVerdict;
  /** 0..100 register-weighted quality score (only meaningful once gates pass). */
  weightedScore: number;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Evaluate a candidate. Any failed hard gate → "reject" (no score can buy it
 * back). All gates clear → compare the weighted score to the threshold: below →
 * "revise", at/above → "pass". `blocking` is always false (advisory / report-only).
 */
export function evaluateQa(candidate: QaCandidate, threshold = QA_DEFAULT_THRESHOLD): QaEvaluation {
  const dimensions: AdvisoryDimension[] = QA_DIMENSIONS.map((d) => {
    const sig = candidate.dimensions[d] ?? { gatePass: true, score: 1 };
    return { name: d, score: clamp01(sig.score), gatePass: sig.gatePass };
  });

  const gatesPassed = dimensions.every((d) => d.gatePass === true);
  const weightedScore = Math.round(
    QA_DIMENSIONS.reduce((acc, d, i) => acc + (dimensions[i].score ?? 0) * QA_WEIGHTS[d], 0) * 100,
  );

  const verdict: QaVerdict = !gatesPassed ? "reject" : weightedScore < threshold ? "revise" : "pass";

  return {
    mode: "report_only",
    blocking: false,
    profile: candidate.profile,
    dimensions,
    note:
      verdict === "reject"
        ? "advisory: a hard gate failed (report-only — not enforced)"
        : `advisory: score ${weightedScore} vs threshold ${threshold} (report-only — not enforced)`,
    verdict,
    weightedScore,
  };
}
