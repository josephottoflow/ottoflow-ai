/**
 * Unit tests — Creative OS activation bridge (Stage 0).
 * Proves the dormant guarantee: null unless every gate is on AND a register is
 * supplied; pure/fail-closed; and that when fully enabled (test-only) it delegates
 * to the certified engines. The null-by-default case is the byte-compat guarantee.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveComposeOverrides } from "./creative-os-bridge";
import { composeRegister } from "../creative-os/register/engine";
import { activeCaptionOverrides } from "../creative-os/caption/activation";

const F = { width: 1080, height: 1920 };
const ALL_ON = {
  CREATIVE_OS_ENABLED: "true",
  CREATIVE_OS_REGISTER: "true",
  CREATIVE_OS_CAPTION: "true",
} as NodeJS.ProcessEnv;

test("null by default — empty env, no register (the byte-identical state)", () => {
  assert.equal(resolveComposeOverrides({ frame: F }, {}), null);
});

test("null with all flags on but NO register supplied", () => {
  assert.equal(resolveComposeOverrides({ frame: F }, ALL_ON), null);
});

test("null with a register but flags OFF", () => {
  assert.equal(resolveComposeOverrides({ register: "luxury", frame: F }, {}), null);
});

test("null when register + master on but the caption capability is off", () => {
  assert.equal(
    resolveComposeOverrides({ register: "luxury", frame: F }, {
      CREATIVE_OS_ENABLED: "true",
      CREATIVE_OS_REGISTER: "true",
    }),
    null,
  );
});

test("returns composed overrides only when fully enabled + register present (test-only)", () => {
  const o = resolveComposeOverrides({ register: "luxury", frame: F }, ALL_ON);
  assert.ok(o, "expected overrides when fully enabled");
  assert.equal(o.register, "luxury");
  assert.deepEqual(o.composed, composeRegister("luxury", F));
  assert.deepEqual(o.caption, activeCaptionOverrides("luxury", ALL_ON));
});

test("fail-closed — a malformed frame yields null, never throws", () => {
  assert.equal(
    resolveComposeOverrides({ register: "luxury", frame: undefined as unknown as typeof F }, ALL_ON),
    null,
  );
});

test("pure/deterministic for identical inputs", () => {
  assert.deepEqual(
    resolveComposeOverrides({ register: "fitness", frame: F }, ALL_ON),
    resolveComposeOverrides({ register: "fitness", frame: F }, ALL_ON),
  );
});
