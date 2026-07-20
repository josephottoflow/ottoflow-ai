/**
 * Unit tests — Motion token dictionary.
 * Locks the invariants the engine relies on: every treatment has a well-formed
 * signature, the hold treatment is genuinely still, no easing is linear, the
 * budget encodes the Motion System invariants, and the temperatures are ordered
 * (hook faster than question; question has no overshoot).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MOTION_SIGNATURE_TOKENS,
  MOTION_TREATMENTS,
  MOTION_EASINGS,
  MOTION_BUDGET,
} from "./motion";

test("every treatment has a well-formed signature", () => {
  for (const t of MOTION_TREATMENTS) {
    const s = MOTION_SIGNATURE_TOKENS[t];
    assert.ok(s, `missing signature for ${t}`);
    assert.ok(s.supportPop >= 0 && s.supportPop <= 100, `${t} supportPop range`);
    assert.ok(s.keyPop >= 0 && s.keyPop <= 100, `${t} keyPop range`);
    assert.ok(s.overshoot >= 0, `${t} overshoot >= 0`);
    assert.ok(s.wordFadeMs >= 0 && s.staggerMs >= 0, `${t} timings >= 0`);
  }
});

test("hold is genuinely still (no scale movement, no stagger, marked hold)", () => {
  const h = MOTION_SIGNATURE_TOKENS.hold;
  assert.equal(h.hold, true);
  assert.equal(h.supportPop, 100); // 100% = no dip = no movement
  assert.equal(h.staggerMs, 0);
  assert.equal(h.overshoot, 0);
});

test("no easing is linear — everything decelerates into rest (Motion law)", () => {
  const LINEAR = [0, 0, 1, 1];
  for (const [name, curve] of Object.entries(MOTION_EASINGS)) {
    assert.notDeepEqual([...curve], LINEAR, `${name} must not be linear`);
    assert.equal(curve.length, 4, `${name} must be a cubic-bezier 4-tuple`);
    // control x-coordinates are within [0,1]
    assert.ok(curve[0] >= 0 && curve[0] <= 1 && curve[2] >= 0 && curve[2] <= 1, `${name} x out of range`);
  }
});

test("budget encodes the Motion System invariants", () => {
  assert.equal(MOTION_BUDGET.primaryMax, 1);
  assert.equal(MOTION_BUDGET.emphasisPerBeat, 1);
  assert.ok(MOTION_BUDGET.continuousMax > 0 && MOTION_BUDGET.continuousMax < 1);
  assert.ok(MOTION_BUDGET.holdEvery >= 1);
  assert.equal(MOTION_BUDGET.reservedStillness, true);
});

test("temperatures are ordered: hook is faster/punchier than question", () => {
  const hook = MOTION_SIGNATURE_TOKENS.hook;
  const q = MOTION_SIGNATURE_TOKENS.question;
  assert.ok(hook.wordFadeMs < q.wordFadeMs, "hook should fade faster than question");
  assert.ok(hook.staggerMs < q.staggerMs, "hook should stagger tighter than question");
  assert.ok(hook.overshoot > q.overshoot, "hook should overshoot more; question drifts");
  assert.equal(q.overshoot, 0, "question drifts with no overshoot");
});
