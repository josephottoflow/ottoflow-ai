/**
 * COS migration M2C — image typography bridge + shared-registry image binding.
 * Proves: (1) legacy/absent resolves to null (byte-safe default path), (2) each
 * Creative OS style reads its tokens straight from the shared StyleFamily (no
 * duplicated definitions), (3) the overlay→image field mapping mirrors video.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveImageTypography, applyCase } from "./typography";
import { overlayToImageFields } from "@/lib/creative-os/text-style-registry";
import { getStyleFamily } from "@/lib/presentation/styles/registry";

test("legacy / absent / unknown → null (compositor keeps its literals — byte-safe)", () => {
  assert.equal(resolveImageTypography("legacy"), null);
  assert.equal(resolveImageTypography(null), null);
  assert.equal(resolveImageTypography(undefined), null);
  assert.equal(resolveImageTypography("does-not-exist"), null);
});

test("premium reads the SAME tokens as the shared Premium StyleFamily", () => {
  const fam = getStyleFamily("premium")!;
  const t = resolveImageTypography("premium")!;
  assert.equal(t.styleId, "premium");
  assert.equal(t.displayFont, fam.fonts.display); // no duplication — read-through
  assert.equal(t.headline.weight, fam.type.headline.weight); // 700
  assert.equal(t.headline.textCase, fam.type.headline.case); // sentence
  assert.equal(t.cta.weight, fam.type.cta.weight);
});

test("impact is visibly distinct — uppercase, heavier, thicker edge", () => {
  const t = resolveImageTypography("impact")!;
  assert.equal(t.headline.textCase, "upper");
  assert.equal(t.headline.weight, 800);
  const premium = resolveImageTypography("premium")!;
  assert.ok(t.headlineStrokePx >= premium.headlineStrokePx); // impact outline ≥ premium
});

test("founder maps to the corporate/premium register tokens", () => {
  const t = resolveImageTypography("founder")!;
  assert.equal(t.styleId, "premium"); // founder → premium philosophy (corporate register)
  assert.equal(t.headline.textCase, "sentence");
});

test("applyCase: sentence is identity (byte-safe); upper/title transform", () => {
  assert.equal(applyCase("Grow Faster", "sentence"), "Grow Faster");
  assert.equal(applyCase("Grow Faster", "upper"), "GROW FASTER");
  assert.equal(applyCase("grow faster", "title"), "Grow Faster");
});

test("overlayToImageFields mirrors the video binding (byte-safe default)", () => {
  assert.deepEqual(overlayToImageFields({ enabled: true, style: "legacy" }), {}); // nothing set
  assert.deepEqual(overlayToImageFields({ enabled: true, style: "premium" }), { textStyle: "premium" });
  assert.deepEqual(overlayToImageFields({ enabled: true, style: "impact" }), { textStyle: "impact" });
  assert.deepEqual(overlayToImageFields({ enabled: true, style: "founder" }), { textStyle: "founder" });
  assert.deepEqual(overlayToImageFields({ enabled: false }), { textOverlay: false }); // clean asset
});
