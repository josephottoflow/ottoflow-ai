/**
 * Unit tests — QA Engine activation seam.
 * Proves report-only gating (reuses the Phase 1 QA flag) and the advisory
 * guarantee (the returned evaluation never blocks).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeQaEvaluation } from "./activation";
import { evaluateQa, type QaCandidate } from "./engine";

const CAND: QaCandidate = { profile: "test", dimensions: { accessibility: { gatePass: false, score: 1 } } };

test("inactive by default — returns null with an empty environment", () => {
  assert.equal(activeQaEvaluation(CAND, 82, {}), null);
});

test("master gate alone does not activate — report-only mode is required", () => {
  assert.equal(activeQaEvaluation(CAND, 82, { CREATIVE_OS_ENABLED: "true" }), null);
});

test("active only in report-only mode; result matches evaluateQa and never blocks", () => {
  const env = { CREATIVE_OS_ENABLED: "true", CREATIVE_OS_QA_MODE: "report_only" };
  const e = activeQaEvaluation(CAND, 82, env);
  assert.ok(e, "expected an evaluation in report-only mode");
  assert.deepEqual(e, evaluateQa(CAND, 82));
  assert.equal(e.blocking, false); // advisory even though this candidate rejects
  assert.equal(e.verdict, "reject");
});

test("a stray 'blocking' QA mode never activates (Phase 1 flag is fail-closed)", () => {
  // The Phase 1 flag can only resolve qaMode to "off" | "report_only".
  assert.equal(activeQaEvaluation(CAND, 82, { CREATIVE_OS_ENABLED: "true", CREATIVE_OS_QA_MODE: "blocking" }), null);
});
