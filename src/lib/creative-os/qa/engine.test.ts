/**
 * Unit tests — QA Engine.
 * Verifies the gate-first verdict logic (a failed gate rejects regardless of
 * score), the weighted score, the threshold boundary, the missing-dimension
 * default, and — the safety-critical invariant — that `blocking` is ALWAYS false
 * (advisory / report-only), including on a reject.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateQa, type QaCandidate } from "./engine";
import { QA_DIMENSIONS } from "../tokens/qa";

/** Build a candidate with all ten dimensions at the given signal. */
function uniform(gatePass: boolean, score: number): QaCandidate {
  const dimensions = Object.fromEntries(QA_DIMENSIONS.map((d) => [d, { gatePass, score }]));
  return { profile: "test", dimensions };
}

test("all gates pass + full score → pass, weightedScore 100, never blocking", () => {
  const e = evaluateQa(uniform(true, 1), 82);
  assert.equal(e.verdict, "pass");
  assert.equal(e.weightedScore, 100);
  assert.equal(e.blocking, false);
  assert.equal(e.mode, "report_only");
});

test("any failed hard gate → reject regardless of high score, still never blocking", () => {
  const c = uniform(true, 1);
  c.dimensions.accessibility = { gatePass: false, score: 1 }; // one gate down
  const e = evaluateQa(c, 82);
  assert.equal(e.verdict, "reject");
  assert.equal(e.blocking, false); // a reject is advisory, not enforcement
});

test("all gates pass but low score → revise", () => {
  const e = evaluateQa(uniform(true, 0.5), 82); // weighted 50 < 82
  assert.equal(e.verdict, "revise");
  assert.equal(e.weightedScore, 50);
  assert.equal(e.blocking, false);
});

test("threshold boundary: score == threshold → pass", () => {
  const e = evaluateQa(uniform(true, 0.82), 82); // weighted 82
  assert.equal(e.weightedScore, 82);
  assert.equal(e.verdict, "pass");
});

test("weighted score reflects a mix of dimension scores", () => {
  const c = uniform(true, 1);
  // drop half the dimensions to 0 → weighted 50 (even weights)
  QA_DIMENSIONS.slice(0, 5).forEach((d) => (c.dimensions[d] = { gatePass: true, score: 0 }));
  assert.equal(evaluateQa(c, 82).weightedScore, 50);
});

test("absent dimensions default to a clean pass", () => {
  const e = evaluateQa({ profile: "sparse", dimensions: {} }, 82);
  assert.equal(e.weightedScore, 100);
  assert.equal(e.verdict, "pass");
  assert.equal(e.dimensions.length, 10);
});

test("blocking is false on every verdict", () => {
  for (const c of [uniform(true, 1), uniform(true, 0.4), (() => { const x = uniform(true, 1); x.dimensions.story = { gatePass: false, score: 1 }; return x; })()]) {
    assert.equal(evaluateQa(c, 82).blocking, false);
  }
});

test("evaluation is deterministic", () => {
  assert.deepEqual(evaluateQa(uniform(true, 0.7), 82), evaluateQa(uniform(true, 0.7), 82));
});
