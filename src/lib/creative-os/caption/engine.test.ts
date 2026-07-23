/**
 * Unit tests — Caption Engine.
 * Verifies personality resolution + safe default + immutability, the preset-override
 * mapping (keys are production AnimatedPreset fields; values map correctly), and
 * the reading-rhythm floor (per-word budget, hard minimum, clamp never shortens).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCaptionPersonality,
  toPresetOverrides,
  readingFloorMs,
  meetsReadingFloor,
  clampToReadingFloor,
} from "./engine";
import { CAPTION_PERSONALITIES, READING_FLOOR } from "../tokens/caption";

test("resolves the personality per mode; unknown → default", () => {
  for (const m of ["documentary", "founder", "luxury", "ugc", "default"] as const) {
    assert.deepEqual(resolveCaptionPersonality(m), { ...CAPTION_PERSONALITIES[m] });
  }
  assert.deepEqual(resolveCaptionPersonality("nonsense"), { ...CAPTION_PERSONALITIES.default });
  assert.deepEqual(resolveCaptionPersonality(undefined), { ...CAPTION_PERSONALITIES.default });
});

test("returns a fresh object — callers cannot mutate the token table", () => {
  const p = resolveCaptionPersonality("luxury");
  p.chunkWords = 99;
  assert.notEqual(CAPTION_PERSONALITIES.luxury.chunkWords, 99);
});

test("toPresetOverrides maps to AnimatedPreset-compatible fields", () => {
  const p = resolveCaptionPersonality("founder");
  const o = toPresetOverrides(p);
  assert.equal(o.maxWordsPerLine, p.chunkWords);
  assert.equal(o.emphasisMaxTier, p.emphasisMaxTier);
  assert.equal(o.keywordScalePct, p.keywordScalePct);
  assert.equal(o.sizePct, p.sizePct);
  assert.equal(o.boxOpacity, p.boxOpacity);
  assert.equal(o.fadeInMs, p.fadeInMs);
  assert.equal(o.staggerMs, p.staggerMs);
  assert.equal(o.case, p.case);
  // exactly the expected keys — nothing stray that a preset wouldn't understand
  assert.deepEqual(
    Object.keys(o).sort(),
    ["boxOpacity", "case", "emphasisMaxTier", "fadeInMs", "keywordScalePct", "maxWordsPerLine", "sizePct", "staggerMs"],
  );
});

test("reading floor: per-word budget, floored by the hard chunk minimum", () => {
  assert.equal(readingFloorMs(1), READING_FLOOR.minChunkMs); // 1 word → hard floor
  assert.equal(readingFloorMs(5), 5 * READING_FLOOR.minMsPerWord); // 900 > 700
  assert.equal(readingFloorMs(0), READING_FLOOR.minChunkMs);
});

test("meetsReadingFloor: below fails, at/above passes", () => {
  assert.equal(meetsReadingFloor(600, 3), false); // needs 700
  assert.equal(meetsReadingFloor(700, 3), true);
  assert.equal(meetsReadingFloor(1000, 5), true); // needs 900
});

test("clampToReadingFloor extends short durations, never shortens long ones", () => {
  assert.equal(clampToReadingFloor(500, 3), 700); // extended to floor
  assert.equal(clampToReadingFloor(1500, 3), 1500); // already comfortable
});
