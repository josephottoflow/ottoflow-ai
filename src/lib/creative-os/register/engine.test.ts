/**
 * Unit tests — Register Engine (orchestration).
 * Verifies register resolution + safe default, and — critically — that
 * composeRegister DELEGATES to each certified engine (does not re-implement them)
 * and never mutates their token tables. Different registers must produce different
 * composed voices.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRegister, composeRegister } from "./engine";
import { REGISTERS, REGISTER_IDS } from "../tokens/register";
import { resolveCaptionPersonality, toPresetOverrides } from "../caption/engine";
import { resolveMotionSig } from "../motion/engine";
import { resolveSafeInsets } from "../layout/engine";
import { resolveTypeSpec } from "../typography/engine";
import { CAPTION_PERSONALITIES } from "../tokens/caption";

const F = { width: 1080, height: 1920 };

test("resolves each register; unknown → the neutral founder register", () => {
  for (const id of REGISTER_IDS) assert.deepEqual(resolveRegister(id), { ...REGISTERS[id] });
  assert.deepEqual(resolveRegister("nonsense"), { ...REGISTERS.founder });
  assert.deepEqual(resolveRegister(undefined), { ...REGISTERS.founder });
});

test("composeRegister DELEGATES each concern to its owning engine", () => {
  const c = composeRegister("luxury", F);
  assert.equal(c.id, "luxury");
  // Caption: exactly the Caption Engine's own output for the register's mode.
  assert.deepEqual(c.caption, toPresetOverrides(resolveCaptionPersonality("luxury")));
  // Motion: the Motion Engine's statement signature.
  assert.deepEqual(c.motionStatement, resolveMotionSig("statement"));
  // Layout: the Layout Engine's safe insets for the frame.
  assert.deepEqual(c.safeInsets, resolveSafeInsets(F));
  // Typography: the Typography Engine's display spec.
  assert.deepEqual(c.displayType, resolveTypeSpec("display", F.height));
  // Register's own dials carried through.
  assert.equal(c.passThreshold, REGISTERS.luxury.passThreshold);
  assert.equal(c.emphasis, REGISTERS.luxury.emphasis);
});

test("different registers compose different voices", () => {
  const lux = composeRegister("luxury", F);
  const ugc = composeRegister("ugc", F);
  assert.notDeepEqual(lux.caption, ugc.caption); // different caption personalities
  assert.notEqual(lux.paceMult, ugc.paceMult);
  assert.notEqual(lux.spaceMult, ugc.spaceMult);
});

test("orchestration never mutates the sub-engines' token tables", () => {
  const c = composeRegister("luxury", F);
  c.caption.maxWordsPerLine = 999;
  c.emphasis = 999;
  assert.notEqual(CAPTION_PERSONALITIES.luxury.chunkWords, 999);
  assert.notEqual(REGISTERS.luxury.emphasis, 999);
});

test("composition is deterministic", () => {
  assert.deepEqual(composeRegister("fitness", F), composeRegister("fitness", F));
});
