/**
 * Unit tests — Creative OS feature-flag scaffolding.
 * Runner: Node's built-in test runner (`node:test`) via tsx. No new dependency.
 *
 * These lock the two guarantees the safety infrastructure depends on:
 *   1. Everything defaults OFF with an empty/production environment.
 *   2. Flags are fail-closed — only the exact expected strings enable anything,
 *      and a blocking QA mode can never be produced.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCreativeOsFlags } from "./flags";

test("defaults OFF when the environment is empty", () => {
  const f = resolveCreativeOsFlags({});
  assert.equal(f.enabled, false);
  assert.equal(f.qaMode, "off");
  assert.equal(f.typography, false);
  assert.equal(f.motion, false);
  assert.equal(f.layout, false);
});

test("master gate is fail-closed — only the exact string 'true' enables it", () => {
  assert.equal(resolveCreativeOsFlags({ CREATIVE_OS_ENABLED: "1" }).enabled, false);
  assert.equal(resolveCreativeOsFlags({ CREATIVE_OS_ENABLED: "TRUE" }).enabled, false);
  assert.equal(resolveCreativeOsFlags({ CREATIVE_OS_ENABLED: "yes" }).enabled, false);
  assert.equal(resolveCreativeOsFlags({ CREATIVE_OS_ENABLED: " true " }).enabled, false);
  assert.equal(resolveCreativeOsFlags({ CREATIVE_OS_ENABLED: "true" }).enabled, true);
});

test("QA report_only requires the master gate to be on", () => {
  // Report-only requested but master gate off → still off.
  assert.equal(
    resolveCreativeOsFlags({ CREATIVE_OS_QA_MODE: "report_only" }).qaMode,
    "off",
  );
  // Both on → report_only.
  assert.equal(
    resolveCreativeOsFlags({
      CREATIVE_OS_ENABLED: "true",
      CREATIVE_OS_QA_MODE: "report_only",
    }).qaMode,
    "report_only",
  );
});

test("QA mode is fail-closed — 'blocking' (or any stray value) can never be produced", () => {
  assert.equal(
    resolveCreativeOsFlags({
      CREATIVE_OS_ENABLED: "true",
      CREATIVE_OS_QA_MODE: "blocking",
    }).qaMode,
    "off",
  );
  assert.equal(
    resolveCreativeOsFlags({
      CREATIVE_OS_ENABLED: "true",
      CREATIVE_OS_QA_MODE: "REPORT_ONLY",
    }).qaMode,
    "off",
  );
});

test("typography capability requires the master gate + exact 'true'", () => {
  // Requested but master gate off → still off.
  assert.equal(resolveCreativeOsFlags({ CREATIVE_OS_TYPOGRAPHY: "true" }).typography, false);
  // Master on but non-exact value → off (fail-closed).
  assert.equal(
    resolveCreativeOsFlags({ CREATIVE_OS_ENABLED: "true", CREATIVE_OS_TYPOGRAPHY: "on" }).typography,
    false,
  );
  assert.equal(
    resolveCreativeOsFlags({ CREATIVE_OS_ENABLED: "true", CREATIVE_OS_TYPOGRAPHY: "1" }).typography,
    false,
  );
  // Both on → enabled.
  assert.equal(
    resolveCreativeOsFlags({ CREATIVE_OS_ENABLED: "true", CREATIVE_OS_TYPOGRAPHY: "true" }).typography,
    true,
  );
});

test("typography does not disturb the other flags", () => {
  const f = resolveCreativeOsFlags({ CREATIVE_OS_ENABLED: "true", CREATIVE_OS_TYPOGRAPHY: "true" });
  assert.equal(f.enabled, true);
  assert.equal(f.qaMode, "off"); // typography must not imply QA
  assert.equal(f.motion, false); // nor motion
});

test("motion capability requires the master gate + exact 'true'", () => {
  assert.equal(resolveCreativeOsFlags({ CREATIVE_OS_MOTION: "true" }).motion, false); // gate off
  assert.equal(
    resolveCreativeOsFlags({ CREATIVE_OS_ENABLED: "true", CREATIVE_OS_MOTION: "on" }).motion,
    false, // fail-closed
  );
  assert.equal(
    resolveCreativeOsFlags({ CREATIVE_OS_ENABLED: "true", CREATIVE_OS_MOTION: "true" }).motion,
    true,
  );
});

test("motion and typography are independent capabilities", () => {
  const onlyMotion = resolveCreativeOsFlags({ CREATIVE_OS_ENABLED: "true", CREATIVE_OS_MOTION: "true" });
  assert.equal(onlyMotion.motion, true);
  assert.equal(onlyMotion.typography, false);
});

test("layout capability requires the master gate + exact 'true', independent of others", () => {
  assert.equal(resolveCreativeOsFlags({ CREATIVE_OS_LAYOUT: "true" }).layout, false); // gate off
  assert.equal(
    resolveCreativeOsFlags({ CREATIVE_OS_ENABLED: "true", CREATIVE_OS_LAYOUT: "on" }).layout,
    false, // fail-closed
  );
  const only = resolveCreativeOsFlags({ CREATIVE_OS_ENABLED: "true", CREATIVE_OS_LAYOUT: "true" });
  assert.equal(only.layout, true);
  assert.equal(only.motion, false);
  assert.equal(only.typography, false);
});

test("resolveCreativeOsFlags is pure — it does not read or mutate process.env", () => {
  const before = process.env.CREATIVE_OS_ENABLED;
  const snap = resolveCreativeOsFlags({ CREATIVE_OS_ENABLED: "true" });
  assert.equal(snap.enabled, true);
  // The real process.env was never touched by passing an explicit map.
  assert.equal(process.env.CREATIVE_OS_ENABLED, before);
});
