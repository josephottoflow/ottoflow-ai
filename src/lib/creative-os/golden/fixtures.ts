/**
 * Deterministic fixtures for the golden / Legacy byte-compat harness.
 *
 * Fixed, hand-authored caption inputs that exercise the Legacy renderAss code
 * paths: single-line ("Punch" style), multi-line ("Regular" style), ASS escaping
 * (braces + backslash), and multiple events. No randomness, no clock, no I/O —
 * so the captured golden output is stable across machines and runs.
 */
import type { TimedCaption } from "../../ffmpeg-pipeline/types";

export interface LegacyCaseFixture {
  name: string;
  captions: TimedCaption[];
  dims: { width: number; height: number };
}

/** The production default canvas (vertical 9:16). */
export const LEGACY_DIMS = { width: 1080, height: 1920 } as const;

export const LEGACY_CAPTION_FIXTURES: LegacyCaseFixture[] = [
  {
    name: "single-line-punch",
    dims: { ...LEGACY_DIMS },
    captions: [
      { sceneId: 0, text: "Make it effortless", startMs: 0, endMs: 1500, lineBreaks: ["Make it effortless"] },
    ],
  },
  {
    name: "multi-line-regular",
    dims: { ...LEGACY_DIMS },
    captions: [
      { sceneId: 0, text: "Two lines here now", startMs: 200, endMs: 2200, lineBreaks: ["Two lines", "here now"] },
    ],
  },
  {
    name: "escape-chars",
    dims: { ...LEGACY_DIMS },
    captions: [
      { sceneId: 1, text: "Braces {x} and back\\slash", startMs: 0, endMs: 1000, lineBreaks: ["Braces {x} and back\\slash"] },
    ],
  },
  {
    name: "multi-event",
    dims: { ...LEGACY_DIMS },
    captions: [
      { sceneId: 0, text: "First", startMs: 0, endMs: 900, lineBreaks: ["First"] },
      { sceneId: 1, text: "Second line pair", startMs: 900, endMs: 2000, lineBreaks: ["Second line", "pair"] },
    ],
  },
];
