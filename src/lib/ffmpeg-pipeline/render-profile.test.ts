/**
 * Unit tests — Render Profile (Stage 1: the creative_founder profile).
 * Locks that the new profile is additive, carries register:"founder", and — with
 * base LEGACY flags — is byte-identical to Legacy until the bridge activates it.
 * Legacy and the existing Modern profiles are unchanged.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRenderFlagsForJob, LEGACY_FLAGS, normalizeProfile, isRenderProfile } from "./render-profile";
import { PHILOSOPHY_IDS } from "../presentation/styles/registry";

test("creative_founder resolves with base LEGACY flags + register:founder", () => {
  const f = resolveRenderFlagsForJob("creative_founder");
  assert.equal(f.profile, "creative_founder");
  assert.equal(f.register, "founder");
  // base flags are Legacy → byte-identical rendering until the bridge activates
  assert.equal(f.captionEngine, LEGACY_FLAGS.captionEngine); // "static"
  assert.equal(f.captionStyle, LEGACY_FLAGS.captionStyle); // "classic"
  assert.equal(f.audioMixProfile, LEGACY_FLAGS.audioMixProfile);
  assert.equal(f.endScreenMode, LEGACY_FLAGS.endScreenMode);
});

test("Legacy is unchanged and carries no register", () => {
  const f = resolveRenderFlagsForJob("legacy");
  assert.equal(f.profile, "legacy");
  assert.equal(f.register, undefined);
  assert.equal(f.captionEngine, "static");
});

test("existing Modern profiles are unchanged and carry no register", () => {
  const v1 = resolveRenderFlagsForJob("modern_v1");
  assert.equal(v1.captionEngine, "animated");
  assert.equal(v1.captionStyle, "corporate");
  assert.equal(v1.register, undefined);
  const v2 = resolveRenderFlagsForJob("modern_v2");
  assert.equal(v2.captionStyle, "bold_creator");
  assert.equal(v2.register, undefined);
});

test("an absent/invalid profile still resolves to Legacy (no register)", () => {
  assert.equal(resolveRenderFlagsForJob(undefined).profile, "legacy");
  assert.equal(resolveRenderFlagsForJob("nonsense").profile, "legacy");
  assert.equal(resolveRenderFlagsForJob("nonsense").register, undefined);
});

test("creative_founder is a recognised profile (accepts spacing/case variants)", () => {
  assert.equal(normalizeProfile("Creative Founder"), "creative_founder");
  assert.equal(normalizeProfile("creative-founder"), "creative_founder");
});

test("no other register profile exists (only Founder is selectable)", () => {
  for (const other of ["creative_luxury", "creative_ugc", "creative_fitness"]) {
    assert.equal(normalizeProfile(other), null, `${other} must not be a profile`);
    assert.equal(resolveRenderFlagsForJob(other).profile, "legacy");
  }
});

// ── COS migration M1: Creative OS philosophy profiles (registry-derived) ──────
test("Creative OS philosophy ids are recognised render profiles", () => {
  for (const id of PHILOSOPHY_IDS) {
    assert.ok(isRenderProfile(id), `${id} must be a recognised profile`);
    assert.equal(normalizeProfile(id), id);
  }
  assert.ok(PHILOSOPHY_IDS.includes("premium"));
  assert.ok(PHILOSOPHY_IDS.includes("impact"));
});

test("a philosophy profile resolves to the Motion engine (explicit per-render opt-in)", () => {
  const f = resolveRenderFlagsForJob("editorial");
  assert.equal(f.profile, "editorial");
  assert.equal(f.captionEngine, "animated");
  assert.equal(f.captionStyle, "editorial"); // philosophy id passed through to renderAss
  assert.equal(f.presentationEngine, "motion");
  assert.equal(f.register, undefined); // not a register profile
});

test("byte-safety: NO existing profile carries presentationEngine (stays env-pinned)", () => {
  for (const p of ["legacy", "modern_v1", "modern_v2", "experimental", "creative_founder"]) {
    assert.equal(
      resolveRenderFlagsForJob(p).presentationEngine,
      undefined,
      `${p} must not force an engine — production stays classic-modern pinned`,
    );
  }
});

test("isRenderProfile rejects unknown values (allowlist is strict)", () => {
  assert.equal(isRenderProfile("nonsense"), false);
  assert.equal(isRenderProfile(""), false);
  assert.equal(isRenderProfile(undefined), false);
});
