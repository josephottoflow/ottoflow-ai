/**
 * Unit tests — Caption token dictionary.
 * Locks the personality invariants: every mode is well-formed, the temperatures
 * are ordered (ugc punchiest/fastest, luxury quietest ground, documentary defers),
 * captions never all-caps, and the reading floor is positive.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPTION_PERSONALITIES, CAPTION_MODES, READING_FLOOR } from "./caption";

test("every mode is well-formed", () => {
  for (const m of CAPTION_MODES) {
    const p = CAPTION_PERSONALITIES[m];
    assert.ok(p, `missing personality for ${m}`);
    assert.ok(p.chunkWords >= 1 && p.chunkWords <= 5, `${m} chunkWords range`);
    assert.ok(p.emphasisMaxTier >= 1 && p.emphasisMaxTier <= 8, `${m} tier range`);
    assert.ok(p.keywordScalePct >= 100 && p.keywordScalePct <= 140, `${m} keywordScale range`);
    assert.ok(p.sizePct > 0 && p.sizePct < 0.12, `${m} sizePct range`);
    assert.ok(p.boxOpacity >= 0 && p.boxOpacity <= 1, `${m} boxOpacity range`);
    assert.ok(p.fadeInMs >= 0 && p.staggerMs >= 0, `${m} timings`);
  }
});

test("captions are never all-caps (read as sentence)", () => {
  for (const m of CAPTION_MODES) {
    assert.notEqual(CAPTION_PERSONALITIES[m].case, "upper", `${m} should not be all-caps`);
  }
});

test("UGC is the punchiest: smallest chunk, fastest pace, strongest emphasis", () => {
  const ugc = CAPTION_PERSONALITIES.ugc;
  const lux = CAPTION_PERSONALITIES.luxury;
  assert.ok(ugc.chunkWords <= lux.chunkWords, "ugc chunk smaller/equal");
  assert.ok(ugc.fadeInMs < lux.fadeInMs, "ugc faster than luxury");
  assert.ok(ugc.emphasisMaxTier > lux.emphasisMaxTier, "ugc emphasises more than luxury");
  assert.ok(ugc.keywordScalePct > lux.keywordScalePct, "ugc lifts keywords harder");
});

test("luxury has the quietest ground; documentary uses a restrained plate", () => {
  assert.equal(CAPTION_PERSONALITIES.luxury.boxOpacity, 0);
  assert.ok(CAPTION_PERSONALITIES.documentary.boxOpacity > CAPTION_PERSONALITIES.luxury.boxOpacity);
});

test("documentary defers (lower presence than luxury/ugc)", () => {
  assert.ok(CAPTION_PERSONALITIES.documentary.sizePct < CAPTION_PERSONALITIES.luxury.sizePct);
  assert.ok(CAPTION_PERSONALITIES.documentary.sizePct < CAPTION_PERSONALITIES.ugc.sizePct);
});

test("reading floor is positive", () => {
  assert.ok(READING_FLOOR.minMsPerWord > 0);
  assert.ok(READING_FLOOR.minChunkMs > 0);
});
