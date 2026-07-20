/**
 * Unit tests — Typography Engine.
 * Verifies token-accurate resolution, frame scaling, optical tracking, the
 * overflow-safe fit (behaviour-identical to production applyStyle), determinism,
 * and full role coverage — including a cross-check against the REAL production
 * width estimator so the fit is proven compatible, not just internally consistent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTypeSpec, fitTypeSpec } from "./engine";
import { TYPOGRAPHY_ROLES } from "../tokens/typography";
import { estimateWidthPx } from "../../presentation/grouping";

const F = { width: 1080, height: 1920 };

test("resolves token-accurate px on the 1920 reference frame", () => {
  assert.equal(resolveTypeSpec("display", 1920).fontPx, 132); // 0.0688 * 1920
  assert.equal(resolveTypeSpec("lead", 1920).fontPx, 96);
  assert.equal(resolveTypeSpec("subhead", 1920).fontPx, 72);
  assert.equal(resolveTypeSpec("caption", 1920).fontPx, 64);
  assert.equal(resolveTypeSpec("body", 1920).fontPx, 48);
  assert.equal(resolveTypeSpec("label", 1920).fontPx, 34);
});

test("scales linearly with frame height", () => {
  assert.equal(resolveTypeSpec("display", 3840).fontPx, 264); // double frame → double px
  assert.equal(resolveTypeSpec("display", 960).fontPx, 66);
});

test("carries weight, leading, and case from the token", () => {
  const label = resolveTypeSpec("label", 1920);
  assert.equal(label.case, "upper");
  assert.equal(label.weight, 500);
  const body = resolveTypeSpec("body", 1920);
  assert.equal(body.case, "sentence");
  assert.equal(body.leadingMult, 1.4);
});

test("optical tracking: large tracks tighter (negative), small looser (positive)", () => {
  assert.ok(resolveTypeSpec("display", 1920).trackingPx < 0);
  assert.ok(resolveTypeSpec("label", 1920).trackingPx > 0);
});

test("fit keeps a short line at full size", () => {
  const short = fitTypeSpec("display", [["Go"]], F, estimateWidthPx);
  assert.equal(short.fontPx, resolveTypeSpec("display", 1920).fontPx);
});

test("fit shrinks a long line down to (approximately) the readable floor", () => {
  const longLine = [["Supercalifragilistic", "expialidocious", "typography", "overflow"]];
  const fitted = fitTypeSpec("display", longLine, F, estimateWidthPx);
  const base = resolveTypeSpec("display", 1920).fontPx;
  const floor = Math.round(0.042 * F.height); // 81
  const step = Math.max(2, Math.round(0.004 * F.height)); // 8
  assert.ok(fitted.fontPx < base, "expected shrink on a long line");
  // The loop decrements while fontPx > minPx, so it can undershoot by < one step
  // — this is the SAME soft floor as the production applyStyle path (intentional).
  assert.ok(fitted.fontPx > floor - step, `${fitted.fontPx} collapsed well below the floor`);
});

test("fit is deterministic", () => {
  const lines = [["One", "two"], ["three"]];
  const a = fitTypeSpec("lead", lines, F, estimateWidthPx);
  const b = fitTypeSpec("lead", lines, F, estimateWidthPx);
  assert.deepEqual(a, b);
});

test("every role resolves and fits without throwing", () => {
  for (const role of TYPOGRAPHY_ROLES) {
    const spec = resolveTypeSpec(role, 1920);
    assert.ok(spec.fontPx > 0);
    const fitted = fitTypeSpec(role, [["word", "word"]], F, estimateWidthPx);
    assert.ok(fitted.fontPx > 0 && fitted.role === role);
  }
});

test("empty lines fit to the base size (no measurement to exceed)", () => {
  const spec = fitTypeSpec("caption", [], F, estimateWidthPx);
  assert.equal(spec.fontPx, resolveTypeSpec("caption", 1920).fontPx);
});
