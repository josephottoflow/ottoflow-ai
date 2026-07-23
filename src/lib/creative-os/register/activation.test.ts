/**
 * Unit tests — Register Engine activation seam.
 * Proves the inactive-by-default guarantee: off → null (no composed register);
 * on → the composed register bundle.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeRegister } from "./activation";
import { composeRegister } from "./engine";

const F = { width: 1080, height: 1920 };

test("inactive by default — returns null with an empty environment", () => {
  assert.equal(activeRegister("luxury", F, {}), null);
});

test("gated — the master gate alone does not activate it", () => {
  assert.equal(activeRegister("luxury", F, { CREATIVE_OS_ENABLED: "true" }), null);
});

test("active only with master gate + CREATIVE_OS_REGISTER=true", () => {
  const env = { CREATIVE_OS_ENABLED: "true", CREATIVE_OS_REGISTER: "true" };
  const r = activeRegister("luxury", F, env);
  assert.ok(r, "expected a composed register when active");
  assert.deepEqual(r, composeRegister("luxury", F));
});

test("unknown id with the flag on composes the neutral founder register", () => {
  const env = { CREATIVE_OS_ENABLED: "true", CREATIVE_OS_REGISTER: "true" };
  assert.deepEqual(activeRegister("nonsense", F, env), composeRegister("founder", F));
});
