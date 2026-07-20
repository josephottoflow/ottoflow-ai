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

test("resolveCreativeOsFlags is pure — it does not read or mutate process.env", () => {
  const before = process.env.CREATIVE_OS_ENABLED;
  const snap = resolveCreativeOsFlags({ CREATIVE_OS_ENABLED: "true" });
  assert.equal(snap.enabled, true);
  // The real process.env was never touched by passing an explicit map.
  assert.equal(process.env.CREATIVE_OS_ENABLED, before);
});
