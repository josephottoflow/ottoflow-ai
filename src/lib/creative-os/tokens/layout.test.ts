/**
 * Unit tests — Layout token dictionary.
 * Locks the invariants the engine relies on: every aspect has a plausible safe
 * zone that leaves a real safe band, 9:16 reserves the most bottom and a wider
 * right (action rail), the density ceiling holds, and the layer order is correct.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SAFE_ZONES, ASPECTS, LAYOUT_DENSITY, LAYER_ORDER } from "./layout";

test("every aspect has a well-formed safe zone that leaves a safe band", () => {
  for (const a of ASPECTS) {
    const z = SAFE_ZONES[a];
    for (const v of [z.topPct, z.bottomPct, z.leftPct, z.rightPct]) {
      assert.ok(v >= 0 && v < 0.5, `${a} inset ${v} out of range`);
    }
    assert.ok(z.topPct + z.bottomPct < 1, `${a} vertical insets consume the frame`);
    assert.ok(z.leftPct + z.rightPct < 1, `${a} horizontal insets consume the frame`);
  }
});

test("9:16 reserves the most at the bottom (caption/handle/CTA band)", () => {
  assert.ok(SAFE_ZONES["9:16"].bottomPct >= SAFE_ZONES["9:16"].topPct);
  assert.ok(SAFE_ZONES["9:16"].bottomPct >= SAFE_ZONES["1:1"].bottomPct);
});

test("9:16 reserves a wider right inset than left (the action rail)", () => {
  assert.ok(SAFE_ZONES["9:16"].rightPct > SAFE_ZONES["9:16"].leftPct);
});

test("density ceiling is a small integer (one idea, held with room)", () => {
  assert.equal(LAYOUT_DENSITY.maxElements, 4);
});

test("layer order: ground first, frame last, message wins over frame", () => {
  assert.deepEqual([...LAYER_ORDER], ["ground", "subject", "message", "frame"]);
  assert.ok(LAYER_ORDER.indexOf("message") < LAYER_ORDER.indexOf("frame"));
  assert.ok(LAYER_ORDER.indexOf("ground") < LAYER_ORDER.indexOf("subject"));
});
