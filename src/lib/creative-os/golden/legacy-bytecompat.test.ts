/**
 * Legacy byte-compatibility + determinism suite (Phase 1 safety infrastructure).
 *
 * The single most important guard of the render freeze. It locks the Legacy
 * caption output (`renderAss` static path) to a committed golden snapshot so that
 * ANY future change altering Legacy output fails CI loudly. It also proves the
 * default (no-profile) path IS Legacy, that rendering is deterministic, and that
 * the Presentation Engine is pure and non-throwing in its Phase-1 identity state.
 *
 * Env-immunity: the golden cases pass { captionEngine: "static" } explicitly, so
 * the captured output does not depend on the ambient CAPTION_ENGINE env var.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAss } from "../../ffmpeg-pipeline/ass-captions";
import { runPresentationEngine } from "../../presentation/engine";
import { LEGACY_CAPTION_FIXTURES } from "./fixtures";
import { matchGolden } from "./harness";

for (const fx of LEGACY_CAPTION_FIXTURES) {
  test(`Legacy ASS is byte-identical to golden — ${fx.name}`, () => {
    const out = renderAss(fx.captions, undefined, fx.dims, { captionEngine: "static" });
    const r = matchGolden(`legacy/${fx.name}.ass`, out);
    assert.ok(
      r.matched,
      `Legacy ASS drifted for "${fx.name}": actual ${r.actualSha.slice(0, 12)} ` +
        `vs golden ${r.goldenSha?.slice(0, 12)}. If this change is intentional, ` +
        `re-capture with UPDATE_GOLDEN=1 and review the diff.`,
    );
  });
}

test("no-profile default equals explicit Legacy static (the default path is Legacy)", () => {
  const prev = process.env.CAPTION_ENGINE;
  delete process.env.CAPTION_ENGINE; // assert the true default, independent of dev env
  try {
    for (const fx of LEGACY_CAPTION_FIXTURES) {
      const def = renderAss(fx.captions, undefined, fx.dims);
      const explicit = renderAss(fx.captions, undefined, fx.dims, { captionEngine: "static" });
      assert.equal(def, explicit, `default vs explicit static differ for ${fx.name}`);
    }
  } finally {
    if (prev === undefined) delete process.env.CAPTION_ENGINE;
    else process.env.CAPTION_ENGINE = prev;
  }
});

test("Legacy renderAss is deterministic (same input → identical output)", () => {
  for (const fx of LEGACY_CAPTION_FIXTURES) {
    const a = renderAss(fx.captions, undefined, fx.dims, { captionEngine: "static" });
    const b = renderAss(fx.captions, undefined, fx.dims, { captionEngine: "static" });
    assert.equal(a, b, `nondeterministic Legacy output for ${fx.name}`);
  }
});

test("Presentation Engine is deterministic and pure (Phase-1 identity is safe)", () => {
  const input = {
    captions: LEGACY_CAPTION_FIXTURES[3].captions,
    frame: { width: 1080, height: 1920 },
  };
  const r1 = runPresentationEngine(input);
  const r2 = runPresentationEngine(input);
  assert.deepEqual(r2.model, r1.model, "engine output is nondeterministic");
  assert.ok(
    Array.isArray(r1.model.beats) && r1.model.beats.length === input.captions.length,
    "engine did not return a usable model",
  );
  assert.ok(
    r1.diagnostics.every((d) => d.ok),
    "a Phase-1 pass threw (should be identity/no-op)",
  );
});
