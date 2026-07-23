/**
 * Unit tests — Typography token dictionary.
 * Locks the invariants the engine and future registers depend on: every role is
 * present and well-formed, the scale is a sane descending ladder, and the
 * editorial rules the tokens encode (caption > body; label is the only all-caps
 * role) hold.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TYPOGRAPHY_TOKENS,
  TYPOGRAPHY_ROLES,
  TYPOGRAPHY_FIT,
  type TypographyRole,
} from "./typography";

const ALL: TypographyRole[] = ["display", "lead", "subhead", "caption", "body", "label", "numeral"];

test("every role is present and well-formed", () => {
  for (const role of ALL) {
    const t = TYPOGRAPHY_TOKENS[role];
    assert.ok(t, `missing token for ${role}`);
    assert.ok(t.sizePct > 0 && t.sizePct < 0.2, `${role} sizePct out of range`);
    assert.ok([400, 500, 600, 700, 800].includes(t.weight), `${role} bad weight`);
    assert.ok(t.leadingMult >= 1 && t.leadingMult <= 1.8, `${role} bad leading`);
    assert.ok(Math.abs(t.trackingPct) <= 0.12, `${role} tracking implausible`);
    assert.ok(["sentence", "upper", "title"].includes(t.case), `${role} bad case`);
  }
});

test("TYPOGRAPHY_ROLES lists every role exactly once", () => {
  assert.equal(TYPOGRAPHY_ROLES.length, ALL.length);
  assert.deepEqual([...TYPOGRAPHY_ROLES].sort(), [...ALL].sort());
});

test("scale is a descending ladder (display largest, label smallest)", () => {
  const sizes = TYPOGRAPHY_ROLES.map((r) => TYPOGRAPHY_TOKENS[r].sizePct);
  for (let i = 1; i < sizes.length; i++) {
    assert.ok(sizes[i] <= sizes[i - 1], `role order not monotonic at index ${i}`);
  }
  assert.equal(TYPOGRAPHY_ROLES[0], "display");
  assert.equal(TYPOGRAPHY_ROLES[TYPOGRAPHY_ROLES.length - 1], "label");
});

test("caption is larger than body (read-in-motion rule) — Typography System §6", () => {
  assert.ok(TYPOGRAPHY_TOKENS.caption.sizePct > TYPOGRAPHY_TOKENS.body.sizePct);
});

test("label is the only all-caps role (editorial: caps are a signal, not a paragraph)", () => {
  for (const role of ALL) {
    assert.equal(
      TYPOGRAPHY_TOKENS[role].case === "upper",
      role === "label",
      `${role} case/upper mismatch`,
    );
  }
});

test("large type tracks tighter, small type tracks looser (optical)", () => {
  assert.ok(TYPOGRAPHY_TOKENS.display.trackingPct < 0, "display should track negative");
  assert.ok(TYPOGRAPHY_TOKENS.label.trackingPct > 0, "label should track positive");
});

test("fit constants match the production convention (84% safe, ~4.2% floor)", () => {
  assert.equal(TYPOGRAPHY_FIT.safeWidthPct, 0.84);
  assert.equal(TYPOGRAPHY_FIT.minSizePct, 0.042);
  assert.ok(TYPOGRAPHY_FIT.stepPct > 0);
});
