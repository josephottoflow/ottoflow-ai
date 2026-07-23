/**
 * Founder activation byte-compat suite (Stage 1).
 *
 * Proves the end-to-end Founder merge through the bridge:
 *   1. With the Creative OS flags ON, a creative_founder render produces output
 *      IDENTICAL to selecting the certified "corporate" Modern preset directly —
 *      Founder reuses byte-tested rendering, introduces no new caption behaviour,
 *      and is locked by a committed golden.
 *   2. With the flags OFF, the same creative_founder job renders Legacy
 *      (byte-identical) — activation is fully gated.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAss } from "../../ffmpeg-pipeline/ass-captions";
import { resolveComposeOverrides, applyCaptionProfile, type CaptionProfile } from "../../ffmpeg-pipeline/creative-os-bridge";
import { LEGACY_CAPTION_FIXTURES } from "./fixtures";
import { matchGolden } from "./harness";

const ACCENT = "#E9863B";
const ALL_ON = {
  CREATIVE_OS_ENABLED: "true",
  CREATIVE_OS_REGISTER: "true",
  CREATIVE_OS_CAPTION: "true",
} as Record<string, string | undefined>;

// The creative_founder profile's BASE flags are Legacy (static/classic); the bridge
// swaps to the corporate preset only when active.
// presentationEngine is PINNED to "classic-modern" (COS migration, Gate I-2): this
// suite locks the ROLLBACK path byte-exactly, independent of the ambient
// PRESENTATION_ENGINE env — restoring the suite's stated env-immunity after the
// Motion Typography Engine made "motion" the ambient default. The motion path gets
// its own golden set during real-footage certification.
const FOUNDER_BASE: CaptionProfile = {
  captionEngine: "static",
  captionStyle: "classic",
  accentColor: ACCENT,
  presentationEngine: "classic-modern",
};

for (const fx of LEGACY_CAPTION_FIXTURES) {
  test(`Founder (flags on) renders through the certified corporate preset — ${fx.name}`, () => {
    const overrides = resolveComposeOverrides({ register: "founder", frame: fx.dims }, ALL_ON);
    const profile = applyCaptionProfile(FOUNDER_BASE, overrides);
    const founderOut = renderAss(fx.captions, undefined, fx.dims, profile);
    // Identical to selecting the corporate preset directly — reuses certified rendering.
    const corporateOut = renderAss(fx.captions, undefined, fx.dims, {
      captionEngine: "animated",
      captionStyle: "corporate",
      accentColor: ACCENT,
      presentationEngine: "classic-modern",
    });
    assert.equal(founderOut, corporateOut, `Founder must render as corporate for ${fx.name}`);
    const r = matchGolden(`founder/${fx.name}.ass`, founderOut);
    assert.ok(r.matched, `Founder golden drift for "${fx.name}"`);
  });
}

test("Founder with the Creative OS flags OFF renders Legacy (byte-identical)", () => {
  const fx = LEGACY_CAPTION_FIXTURES[0];
  const off = applyCaptionProfile(FOUNDER_BASE, resolveComposeOverrides({ register: "founder", frame: fx.dims }, {}));
  const founderOff = renderAss(fx.captions, undefined, fx.dims, off);
  const legacy = renderAss(fx.captions, undefined, fx.dims, {
    captionEngine: "static",
    captionStyle: "classic",
    accentColor: ACCENT,
  });
  assert.equal(founderOff, legacy, "creative_founder with flags off must be Legacy-identical");
});
