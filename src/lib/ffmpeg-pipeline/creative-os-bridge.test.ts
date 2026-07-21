/**
 * Unit tests — Creative OS activation bridge (Stage 1: Founder).
 * Proves: the dormant null-by-default guarantee; that ONLY Founder is activatable;
 * the profile patch (founder → certified "corporate" preset); and the pure
 * applyCaptionProfile merge (null → base unchanged = byte-identical).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveComposeOverrides, applyCaptionProfile, type CaptionProfile } from "./creative-os-bridge";
import { composeRegister } from "../creative-os/register/engine";
import { activeCaptionOverrides } from "../creative-os/caption/activation";

const F = { width: 1080, height: 1920 };
const ALL_ON = {
  CREATIVE_OS_ENABLED: "true",
  CREATIVE_OS_REGISTER: "true",
  CREATIVE_OS_CAPTION: "true",
} as NodeJS.ProcessEnv;

const LEGACY_PROFILE: CaptionProfile = { captionEngine: "static", captionStyle: "classic", accentColor: "#E9863B" };

// ── Dormant / gating ─────────────────────────────────────────────────────────
test("null by default — empty env, no register (the byte-identical state)", () => {
  assert.equal(resolveComposeOverrides({ frame: F }, {}), null);
});

test("null with all flags on but NO register supplied", () => {
  assert.equal(resolveComposeOverrides({ frame: F }, ALL_ON), null);
});

test("null with founder register but flags OFF", () => {
  assert.equal(resolveComposeOverrides({ register: "founder", frame: F }, {}), null);
});

test("null when register + master on but the caption capability is off", () => {
  assert.equal(
    resolveComposeOverrides({ register: "founder", frame: F }, {
      CREATIVE_OS_ENABLED: "true",
      CREATIVE_OS_REGISTER: "true",
    }),
    null,
  );
});

// ── Founder is the ONLY activatable register ────────────────────────────────
test("only Founder activates — every other register returns null even fully on", () => {
  for (const r of ["luxury", "ugc", "fitness", "documentary", "b2c"]) {
    assert.equal(resolveComposeOverrides({ register: r, frame: F }, ALL_ON), null, `${r} must not activate`);
  }
});

test("Founder activates when fully enabled — patches to the certified corporate preset", () => {
  const o = resolveComposeOverrides({ register: "founder", frame: F }, ALL_ON);
  assert.ok(o, "expected overrides for founder when fully enabled");
  assert.equal(o.register, "founder");
  assert.equal(o.profilePatch.captionEngine, "animated");
  assert.equal(o.profilePatch.captionStyle, "corporate");
  assert.deepEqual(o.composed, composeRegister("founder", F));
  assert.deepEqual(o.caption, activeCaptionOverrides("founder", ALL_ON));
});

test("fail-closed — a malformed frame yields null, never throws", () => {
  assert.equal(
    resolveComposeOverrides({ register: "founder", frame: undefined as unknown as typeof F }, ALL_ON),
    null,
  );
});

test("deterministic for identical inputs", () => {
  assert.deepEqual(
    resolveComposeOverrides({ register: "founder", frame: F }, ALL_ON),
    resolveComposeOverrides({ register: "founder", frame: F }, ALL_ON),
  );
});

// ── The merge point ─────────────────────────────────────────────────────────
test("applyCaptionProfile with null overrides returns the base UNCHANGED (byte-identical)", () => {
  const out = applyCaptionProfile(LEGACY_PROFILE, null);
  assert.deepEqual(out, LEGACY_PROFILE);
});

test("applyCaptionProfile with Founder overrides swaps engine+preset, keeps the brand accent", () => {
  const o = resolveComposeOverrides({ register: "founder", frame: F }, ALL_ON);
  const out = applyCaptionProfile(LEGACY_PROFILE, o);
  assert.equal(out.captionEngine, "animated");
  assert.equal(out.captionStyle, "corporate");
  assert.equal(out.accentColor, "#E9863B"); // brand accent preserved
});
