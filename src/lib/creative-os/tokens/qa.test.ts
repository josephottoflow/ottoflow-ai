/**
 * Unit tests — QA token dictionary.
 * Locks the ten dimensions, weights that sum to 1, verdict labels, and a sane
 * default threshold.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { QA_DIMENSIONS, QA_WEIGHTS, QA_VERDICTS, QA_DEFAULT_THRESHOLD } from "./qa";

test("exactly the ten Design-QA dimensions are present", () => {
  assert.equal(QA_DIMENSIONS.length, 10);
  for (const d of QA_DIMENSIONS) assert.ok(d in QA_WEIGHTS, `missing weight for ${d}`);
});

test("weights are positive and sum to 1", () => {
  const sum = QA_DIMENSIONS.reduce((a, d) => a + QA_WEIGHTS[d], 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}, not 1`);
  for (const d of QA_DIMENSIONS) assert.ok(QA_WEIGHTS[d] > 0, `${d} weight must be positive`);
});

test("verdicts are the three advisory labels", () => {
  assert.deepEqual([...QA_VERDICTS], ["reject", "revise", "pass"]);
});

test("default threshold is a sane 0–100 value", () => {
  assert.ok(QA_DEFAULT_THRESHOLD > 0 && QA_DEFAULT_THRESHOLD <= 100);
});
