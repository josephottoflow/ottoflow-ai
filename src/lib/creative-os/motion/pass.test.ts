/**
 * Unit tests — Motion presentation pass.
 * Proves: (1) the pass populates beat.motion from the engine; (2) it is NOT in the
 * default pipeline, so default output is unchanged; (3) the reserved-stillness
 * cadence turns a statement into a hold on the beat; (4) flag-gating via
 * withMotionEngine; (5) fail-safety.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { motionEnginePass, withMotionEngine, effectiveTreatment } from "./pass";
import { DEFAULT_PASSES } from "../../presentation/passes";
import { runPresentationEngine } from "../../presentation/engine";
import { MOTION_SIGNATURE_TOKENS } from "../tokens/motion";
import type { Beat, PresentationModel } from "../../presentation/types";

function model(beats: Partial<Beat>[]): PresentationModel {
  return {
    frame: { width: 1080, height: 1920 },
    config: { maxWordsPerLine: 3, smartGroup: true },
    beats: beats.map((b) => ({
      lines: b.lines ?? [{ words: ["a", "word"] }],
      startMs: 0,
      endMs: 1000,
      sourceText: "a word",
      ...b,
    })) as Beat[],
  };
}

test("pass populates beat.motion from the engine (deterministic)", () => {
  const m = model([{ treatment: "hook" }]);
  const out = motionEnginePass.run(m);
  assert.deepEqual(out.beats[0].motion, { ...MOTION_SIGNATURE_TOKENS.hook });
  assert.deepEqual(motionEnginePass.run(m).beats[0].motion, out.beats[0].motion);
});

test("reserved stillness: a statement on the cadence beat becomes a hold", () => {
  // index 2 is a hold beat; the 3rd statement should render still.
  const m = model([{ treatment: "statement" }, { treatment: "statement" }, { treatment: "statement" }]);
  const out = motionEnginePass.run(m);
  assert.deepEqual(out.beats[2].motion, { ...MOTION_SIGNATURE_TOKENS.hold });
  assert.equal(out.beats[2].motion.hold, true);
  // non-cadence statements keep their own signature
  assert.deepEqual(out.beats[0].motion, { ...MOTION_SIGNATURE_TOKENS.statement });
});

test("a non-statement treatment keeps its signature even on a cadence beat", () => {
  // index 2 is a hold beat, but a 'cta' there keeps cta motion (only statements yield).
  assert.equal(effectiveTreatment({ treatment: "cta" } as Beat, 2), "cta");
  assert.equal(effectiveTreatment({ treatment: "statement" } as Beat, 2), "hold");
  assert.equal(effectiveTreatment({ treatment: "statement" } as Beat, 0), "statement");
});

test("the pass is NOT part of DEFAULT_PASSES (default pipeline unaffected)", () => {
  assert.ok(!DEFAULT_PASSES.some((p) => p.name === "creative-os-motion"));
});

test("default presentation engine output is unchanged — no beat.motion is set", () => {
  const input = {
    captions: [{ sceneId: 0, text: "hello there", startMs: 0, endMs: 1000, lineBreaks: ["hello there"] }],
    frame: { width: 1080, height: 1920 },
  };
  assert.equal(runPresentationEngine(input).model.beats[0].motion, undefined);
});

test("withMotionEngine is flag-gated — off by default, appended only when on", () => {
  assert.equal(withMotionEngine(DEFAULT_PASSES, {}).length, DEFAULT_PASSES.length);
  const on = withMotionEngine(DEFAULT_PASSES, { CREATIVE_OS_ENABLED: "true", CREATIVE_OS_MOTION: "true" });
  assert.equal(on.length, DEFAULT_PASSES.length + 1);
  assert.equal(on[on.length - 1].name, "creative-os-motion");
});

test("fail-safe — a malformed model returns unchanged, never throws", () => {
  const bad = { frame: { width: 1080, height: 1920 }, config: {}, beats: null } as unknown as PresentationModel;
  assert.equal(motionEnginePass.run(bad), bad);
});
