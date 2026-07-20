/**
 * Unit tests — Typography presentation pass.
 * Proves: (1) the pass populates beat.type from the engine; (2) it is NOT in the
 * default pipeline, so default output is unchanged; (3) it is flag-gated via
 * withTypographyEngine; (4) role mapping is deterministic; (5) it is fail-safe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { typographyEnginePass, withTypographyEngine, roleForBeat } from "./pass";
import { DEFAULT_PASSES } from "../../presentation/passes";
import { runPresentationEngine } from "../../presentation/engine";
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

test("pass populates beat.type from the engine (deterministic)", () => {
  const m = model([{ role: "hero", treatment: "hook", lines: [{ words: ["Go"] }] }]);
  const out = typographyEnginePass.run(m);
  const t = out.beats[0].type;
  assert.ok(t, "expected beat.type to be populated");
  assert.equal(t.role, "display"); // hero/hook → display
  assert.equal(t.fontPx, 132); // token-accurate on 1920
  // deterministic
  assert.deepEqual(typographyEnginePass.run(m).beats[0].type, t);
});

test("the pass is NOT part of DEFAULT_PASSES (default pipeline unaffected)", () => {
  assert.ok(
    !DEFAULT_PASSES.some((p) => p.name === "creative-os-typography"),
    "typography pass must not be in the default pipeline",
  );
});

test("default presentation engine output is unchanged — no beat.type is set", () => {
  const input = {
    captions: [
      { sceneId: 0, text: "hello there", startMs: 0, endMs: 1000, lineBreaks: ["hello there"] },
    ],
    frame: { width: 1080, height: 1920 },
  };
  const beats = runPresentationEngine(input).model.beats;
  assert.equal(beats[0].type, undefined, "default pipeline must not set beat.type");
});

test("withTypographyEngine is flag-gated — off by default", () => {
  const composed = withTypographyEngine(DEFAULT_PASSES, {});
  assert.equal(composed.length, DEFAULT_PASSES.length);
  assert.ok(!composed.some((p) => p.name === "creative-os-typography"));
});

test("withTypographyEngine appends the pass only when the flag is on", () => {
  const composed = withTypographyEngine(DEFAULT_PASSES, {
    CREATIVE_OS_ENABLED: "true",
    CREATIVE_OS_TYPOGRAPHY: "true",
  });
  assert.equal(composed.length, DEFAULT_PASSES.length + 1);
  assert.equal(composed[composed.length - 1].name, "creative-os-typography");
});

test("roleForBeat maps deterministically", () => {
  assert.equal(roleForBeat(model([{ treatment: "stat", lines: [{ words: ["42", "percent"] }] }]).beats[0]), "numeral");
  assert.equal(roleForBeat(model([{ treatment: "hook", lines: [{ words: ["Big", "idea"] }] }]).beats[0]), "display");
  assert.equal(roleForBeat(model([{ role: "headline", lines: [{ words: ["the", "key", "thing"] }] }]).beats[0]), "lead");
  assert.equal(roleForBeat(model([{ treatment: "question", lines: [{ words: ["why", "does", "it"] }] }]).beats[0]), "subhead");
  assert.equal(roleForBeat(model([{ treatment: "statement", lines: [{ words: ["a", "longer", "line"] }] }]).beats[0]), "caption");
});

test("fail-safe — a malformed beat returns the model unchanged, never throws", () => {
  const bad = { frame: { width: 1080, height: 1920 }, config: { maxWordsPerLine: 3, smartGroup: true }, beats: [{ lines: null }] } as unknown as PresentationModel;
  const out = typographyEnginePass.run(bad);
  assert.equal(out, bad); // returned unchanged
});
