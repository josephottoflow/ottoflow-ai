/**
 * Unit tests — Motion Engine.
 * Verifies token-accurate signature resolution, safe defaults, immutability,
 * easing resolution (never linear), budget enforcement as a pure predicate, and
 * the reserved-stillness cadence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMotionSig, resolveEasing, withinMotionBudget, isHoldBeat } from "./engine";
import { MOTION_SIGNATURE_TOKENS, MOTION_EASINGS } from "../tokens/motion";

test("resolves the token signature for each treatment", () => {
  for (const t of ["hook", "stat", "turn", "question", "cta", "statement", "hold"] as const) {
    assert.deepEqual(resolveMotionSig(t), { ...MOTION_SIGNATURE_TOKENS[t] });
  }
});

test("unknown treatment falls back to the statement baseline", () => {
  assert.deepEqual(resolveMotionSig("nonsense"), { ...MOTION_SIGNATURE_TOKENS.statement });
  assert.deepEqual(resolveMotionSig(undefined), { ...MOTION_SIGNATURE_TOKENS.statement });
});

test("returns a fresh object — callers cannot mutate the token table", () => {
  const sig = resolveMotionSig("hook");
  sig.supportPop = 999;
  assert.notEqual(MOTION_SIGNATURE_TOKENS.hook.supportPop, 999);
});

test("easing resolves; unknown → standard; never linear", () => {
  assert.deepEqual(resolveEasing("soft"), MOTION_EASINGS.soft);
  assert.deepEqual(resolveEasing("nope"), MOTION_EASINGS.standard);
  assert.notDeepEqual([...resolveEasing("standard")], [0, 0, 1, 1]);
});

test("budget predicate: within limits passes, over any limit fails", () => {
  assert.equal(withinMotionBudget({ primaryMotions: 1, emphasisMoves: 1, continuousRatio: 0.6 }), true);
  assert.equal(withinMotionBudget({ primaryMotions: 2, emphasisMoves: 1, continuousRatio: 0.5 }), false);
  assert.equal(withinMotionBudget({ primaryMotions: 1, emphasisMoves: 2, continuousRatio: 0.5 }), false);
  assert.equal(withinMotionBudget({ primaryMotions: 1, emphasisMoves: 1, continuousRatio: 0.9 }), false);
});

test("reserved-stillness cadence holds every 3rd beat (index 2, 5, 8, …)", () => {
  const holds = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(isHoldBeat);
  assert.deepEqual(holds, [false, false, true, false, false, true, false, false, true]);
});

test("resolution is deterministic", () => {
  assert.deepEqual(resolveMotionSig("cta"), resolveMotionSig("cta"));
});
