/**
 * Unit tests — Layout presentation pass.
 * Proves: (1) the pass annotates beat.layout with safe insets + density while
 * preserving existing keys; (2) it is NOT in the default pipeline; (3) the default
 * engine leaves layout unannotated; (4) flag-gating via withLayoutEngine; (5)
 * fail-safety.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutEnginePass, withLayoutEngine } from "./pass";
import { DEFAULT_PASSES } from "../../presentation/passes";
import { runPresentationEngine } from "../../presentation/engine";
import { resolveSafeInsets } from "./engine";
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

test("pass annotates layout.safe + densityOk, preserving existing keys", () => {
  const m = model([{ layout: { archetype: "centered", fontMult: 1.2 } }]);
  const out = layoutEnginePass.run(m);
  const layout = out.beats[0].layout as Record<string, unknown>;
  assert.deepEqual(layout.safe, resolveSafeInsets(m.frame));
  assert.equal(layout.densityOk, true);
  // existing keys preserved
  assert.equal(layout.archetype, "centered");
  assert.equal(layout.fontMult, 1.2);
});

test("densityOk is false when a beat exceeds the ceiling", () => {
  const m = model([{ lines: [{ words: ["a"] }, { words: ["b"] }, { words: ["c"] }, { words: ["d"] }, { words: ["e"] }] }]);
  const out = layoutEnginePass.run(m);
  assert.equal((out.beats[0].layout as Record<string, unknown>).densityOk, false);
});

test("the pass is NOT part of DEFAULT_PASSES (default pipeline unaffected)", () => {
  assert.ok(!DEFAULT_PASSES.some((p) => p.name === "creative-os-layout"));
});

test("default presentation engine output is not annotated with layout.safe", () => {
  const input = {
    captions: [{ sceneId: 0, text: "hello there", startMs: 0, endMs: 1000, lineBreaks: ["hello there"] }],
    frame: { width: 1080, height: 1920 },
  };
  const layout = runPresentationEngine(input).model.beats[0].layout as Record<string, unknown> | undefined;
  assert.equal(layout?.safe, undefined);
});

test("withLayoutEngine is flag-gated — off by default, appended only when on", () => {
  assert.equal(withLayoutEngine(DEFAULT_PASSES, {}).length, DEFAULT_PASSES.length);
  const on = withLayoutEngine(DEFAULT_PASSES, { CREATIVE_OS_ENABLED: "true", CREATIVE_OS_LAYOUT: "true" });
  assert.equal(on.length, DEFAULT_PASSES.length + 1);
  assert.equal(on[on.length - 1].name, "creative-os-layout");
});

test("fail-safe — a malformed model returns unchanged, never throws", () => {
  const bad = { frame: { width: 1080, height: 1920 }, config: {}, beats: null } as unknown as PresentationModel;
  assert.equal(layoutEnginePass.run(bad), bad);
});
