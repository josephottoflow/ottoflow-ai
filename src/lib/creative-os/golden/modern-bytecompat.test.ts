/**
 * Modern (animated) byte-compatibility suite (Phase 2 regression guard).
 *
 * Phase 2 adds a token-driven Typography Engine in creative-os/ and does NOT touch
 * the existing Modern render path (renderAnimatedAss + the Premium/Impact style
 * families). This suite LOCKS the current Modern caption output for the two smart
 * presets so any future change that alters it fails CI — and, right now, proves
 * Phase 2 left Modern output byte-identical.
 *
 * Env-immunity: captionEngine + captionStyle + accentColor are all passed
 * explicitly, so the captured output is independent of ambient env vars.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAss } from "../../ffmpeg-pipeline/ass-captions";
import { LEGACY_CAPTION_FIXTURES } from "./fixtures";
import { matchGolden } from "./harness";

/** Fixed brand accent so the golden is stable. */
const ACCENT = "#E9863B";
/** The two smart presets that exercise the presentation engine + typography. */
const SMART_PRESETS = ["corporate", "bold_creator"] as const;

for (const preset of SMART_PRESETS) {
  for (const fx of LEGACY_CAPTION_FIXTURES) {
    test(`Modern ${preset} ASS is byte-identical to golden — ${fx.name}`, () => {
      const out = renderAss(fx.captions, undefined, fx.dims, {
        captionEngine: "animated",
        captionStyle: preset,
        accentColor: ACCENT,
        presentationEngine: "classic-modern",
      });
      const r = matchGolden(`modern/${preset}/${fx.name}.ass`, out);
      assert.ok(
        r.matched,
        `Modern ${preset} drifted for "${fx.name}": actual ${r.actualSha.slice(0, 12)} ` +
          `vs golden ${r.goldenSha?.slice(0, 12)}. If intentional, re-capture with ` +
          `UPDATE_GOLDEN=1 and review the diff.`,
      );
    });
  }
}

test("Modern animated output is deterministic (same input → identical output)", () => {
  const fx = LEGACY_CAPTION_FIXTURES[3];
  const opts = { captionEngine: "animated" as const, captionStyle: "corporate" as const, accentColor: ACCENT, presentationEngine: "classic-modern" as const };
  const a = renderAss(fx.captions, undefined, fx.dims, opts);
  const b = renderAss(fx.captions, undefined, fx.dims, opts);
  assert.equal(a, b);
});
