/**
 * Unit tests — Layout Engine.
 * Verifies aspect classification, token-accurate safe insets, safe-area testing,
 * clamping (shift-to-fit and pin-when-too-big), density enforcement, layer order,
 * and determinism.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveAspect,
  resolveSafeInsets,
  safeBox,
  isWithinSafeArea,
  clampToSafeArea,
  withinDensity,
  layerIndex,
} from "./engine";

const V = { width: 1080, height: 1920 }; // 9:16

test("classifies frames to the nearest aspect", () => {
  assert.equal(resolveAspect({ width: 1080, height: 1920 }), "9:16");
  assert.equal(resolveAspect({ width: 1080, height: 1080 }), "1:1");
  assert.equal(resolveAspect({ width: 1920, height: 1080 }), "16:9");
});

test("resolves token-accurate safe insets on 1080x1920", () => {
  const i = resolveSafeInsets(V);
  assert.equal(i.top, 221); // 0.115 * 1920
  assert.equal(i.bottom, 321); // 0.167 * 1920
  assert.equal(i.left, 119); // 0.11 * 1080
  assert.equal(i.right, 180); // 0.167 * 1080
});

test("safeBox is the inner rectangle clear of the reserved insets", () => {
  const s = safeBox(V);
  assert.deepEqual(s, { x1: 119, y1: 221, x2: 1080 - 180, y2: 1920 - 321 });
});

test("isWithinSafeArea: inside → true; overlapping the bottom UI band → false", () => {
  assert.equal(isWithinSafeArea({ x1: 300, y1: 800, x2: 780, y2: 900 }, V), true);
  // a box down in the caption/handle band
  assert.equal(isWithinSafeArea({ x1: 300, y1: 1700, x2: 780, y2: 1850 }, V), false);
});

test("clampToSafeArea shifts a box up out of the reserved band", () => {
  const clamped = clampToSafeArea({ x1: 300, y1: 1700, x2: 780, y2: 1850 }, V);
  assert.ok(isWithinSafeArea(clamped, V), "clamped box must be within safe area");
  // shape preserved (shifted, not resized) since it fits
  assert.equal(clamped.x2 - clamped.x1, 480);
  assert.equal(clamped.y2 - clamped.y1, 150);
});

test("clampToSafeArea pins a box larger than the safe field to the safe bounds", () => {
  const s = safeBox(V);
  const huge = { x1: -100, y1: -100, x2: 2000, y2: 3000 };
  const clamped = clampToSafeArea(huge, V);
  assert.deepEqual(clamped, s);
});

test("density ceiling: at the cap passes, over it fails", () => {
  assert.equal(withinDensity(4), true);
  assert.equal(withinDensity(5), false);
});

test("layerIndex orders ground < subject < message < frame", () => {
  assert.ok(layerIndex("ground") < layerIndex("subject"));
  assert.ok(layerIndex("subject") < layerIndex("message"));
  assert.ok(layerIndex("message") < layerIndex("frame"));
});

test("resolution is deterministic", () => {
  assert.deepEqual(resolveSafeInsets(V), resolveSafeInsets(V));
});
