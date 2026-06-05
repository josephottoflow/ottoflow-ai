/**
 * Remotion Root — registers compositions discoverable by the CLI / bundler.
 *
 * Discoverable via `npx remotion render <id>` and by selectComposition()
 * from the spike runner at scripts/remotion-spike.ts.
 */
import React from "react";
import { Composition } from "remotion";
import { MultiSceneVideo } from "./compositions/MultiSceneVideo";
import { multiSceneVideoSchema, type MultiSceneVideoProps } from "./types";

// Demo data — uses ONE Pexels URL we've verified is publicly accessible
// (matches the clip in the user's recent merged-videos output). All 4
// scene slots use the same source so we can prove the COMPOSITION ENGINE
// (transitions, scene boundaries, overlay position rotation, scale-pop
// animation) without hunting for 4 distinct Pexels hot-linkable URLs.
//
// The point of the demo is the visual proof of multi-scene composition,
// not visual variety — the real-data --job-id mode pulls actual diverse
// scene clips from scene_generations.
const DEMO_VIDEO_URL =
  "https://videos.pexels.com/video-files/6755168/6755168-hd_720_1280_25fps.mp4";

const DEMO_SCENES: MultiSceneVideoProps["scenes"] = [
  { index: 1, url: DEMO_VIDEO_URL, durationSec: 6, provider: "pexels" },
  { index: 2, url: DEMO_VIDEO_URL, durationSec: 6, provider: "pexels" },
  { index: 3, url: DEMO_VIDEO_URL, durationSec: 6, provider: "pexels" },
  { index: 4, url: DEMO_VIDEO_URL, durationSec: 6, provider: "pexels" },
];

// Per-scene 3-word overlays, scene-local timings flattened to absolute.
// Scene 1 starts at 0s, scene 2 at 6s, etc.
const DEMO_OVERLAYS: MultiSceneVideoProps["overlays"] = [
  // Scene 1 (0..6s) — sceneIndex 1 → top-third
  { sceneIndex: 1, text: "STOP",        start: 0.5, end: 1.5 },
  { sceneIndex: 1, text: "SCROLLING",   start: 2.5, end: 3.7 },
  { sceneIndex: 1, text: "NOW",         start: 4.5, end: 5.5 },
  // Scene 2 (6..12s) — sceneIndex 2 → vertical center
  { sceneIndex: 2, text: "WATCH",       start: 6.5, end: 7.5 },
  { sceneIndex: 2, text: "WHAT HAPPENS",start: 8.5, end: 9.9 },
  { sceneIndex: 2, text: "NEXT",        start: 10.5, end: 11.5 },
  // Scene 3 (12..18s) — sceneIndex 3 → lower-third (legacy default)
  { sceneIndex: 3, text: "REAL ESTATE", start: 12.5, end: 13.9 },
  { sceneIndex: 3, text: "REIMAGINED",  start: 14.5, end: 15.9 },
  { sceneIndex: 3, text: "TODAY",       start: 16.5, end: 17.5 },
  // Scene 4 (18..24s) — sceneIndex 4 → very low (above TikTok UI)
  { sceneIndex: 4, text: "BUILT",       start: 18.5, end: 19.5 },
  { sceneIndex: 4, text: "FOR YOU",     start: 20.5, end: 21.7 },
  { sceneIndex: 4, text: "TRY IT",      start: 22.5, end: 23.5 },
];

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MultiSceneVideo"
        component={MultiSceneVideo}
        schema={multiSceneVideoSchema}
        // Will be overridden by calculateMetadata below — Remotion requires
        // a positive default but we compute the real value from props.
        durationInFrames={720} // 24s @ 30fps (matches the demo data)
        fps={30}
        width={720}
        height={1280}
        defaultProps={{
          scenes: DEMO_SCENES,
          overlays: DEMO_OVERLAYS,
          brandColors: undefined,
          transitionSec: 0.4,
        }}
        calculateMetadata={({ props }) => {
          // Sum scene durations + transitions to compute total frames.
          // We don't subtract transition overlap because TransitionSeries
          // already handles overlapping frames internally.
          const totalSec = props.scenes.reduce(
            (acc, s) => acc + s.durationSec,
            0,
          );
          return {
            durationInFrames: Math.max(1, Math.round(totalSec * 30)),
          };
        }}
      />
    </>
  );
};
