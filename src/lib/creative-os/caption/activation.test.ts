/**
 * Unit tests — Caption Engine activation seam.
 * Proves the inactive-by-default guarantee (the caption analogue of the pass
 * exclusion tests): with the flag off, no override is produced; with it on, the
 * mode's overrides are returned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeCaptionOverrides } from "./activation";
import { toPresetOverrides, resolveCaptionPersonality } from "./engine";

test("inactive by default — returns null with an empty environment", () => {
  assert.equal(activeCaptionOverrides("luxury", {}), null);
});

test("gated — the master gate alone does not activate it", () => {
  assert.equal(activeCaptionOverrides("luxury", { CREATIVE_OS_ENABLED: "true" }), null);
});

test("active only with master gate + CREATIVE_OS_CAPTION=true", () => {
  const env = { CREATIVE_OS_ENABLED: "true", CREATIVE_OS_CAPTION: "true" };
  const o = activeCaptionOverrides("luxury", env);
  assert.ok(o, "expected overrides when active");
  assert.deepEqual(o, toPresetOverrides(resolveCaptionPersonality("luxury")));
});

test("unknown mode with the flag on resolves to the default personality", () => {
  const env = { CREATIVE_OS_ENABLED: "true", CREATIVE_OS_CAPTION: "true" };
  assert.deepEqual(
    activeCaptionOverrides("nonsense", env),
    toPresetOverrides(resolveCaptionPersonality("default")),
  );
});
