/**
 * MultiSceneVideo — the spike composition.
 *
 * Replaces (in spike form) what worker/processors/video-merge.ts currently
 * does with per-scene normalize + concat demuxer + drawtext chain:
 *
 *   - Multi-scene video stream via <TransitionSeries> + <OffthreadVideo>
 *     with optional fade transitions between scenes (FFmpeg has NONE today)
 *   - Per-scene 3-word overlays via <Sequence> + <OverlayText> with
 *     sceneIndex-aware position rotation (v2 P3)
 *
 * NO audio. This composition renders the SILENT visual stream. The
 * existing worker ffmpeg invocation then muxes narration + ducked music.
 * That's the "Hybrid" in ADR-001 Option C.
 *
 * Total duration is computed from sum(scenes[].durationSec) by
 * Root.tsx's calculateMetadata — the composition itself just emits frames.
 */
import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  useVideoConfig,
} from "remotion";
import {
  linearTiming,
  TransitionSeries,
} from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { OverlayText } from "./OverlayText";
import type { MultiSceneVideoProps } from "../types";

export const MultiSceneVideo: React.FC<MultiSceneVideoProps> = ({
  scenes,
  overlays,
  brandColors,
  transitionSec = 0.4,
}) => {
  const { fps } = useVideoConfig();
  const transitionFrames = Math.max(1, Math.round(transitionSec * fps));

  return (
    <AbsoluteFill
      style={{
        backgroundColor: brandColors?.background ?? "#000000",
      }}
    >
      {/* ─── Visual track: scenes with crossfade between each pair ────── */}
      <TransitionSeries>
        {scenes.map((scene, i) => {
          const sceneFrames = Math.max(
            1,
            Math.round(scene.durationSec * fps),
          );
          // TransitionSeries demands the Sequence and Transition siblings
          // be alternating top-level children — wrap with Fragment.
          return (
            <React.Fragment key={`scene-${scene.index}-${i}`}>
              <TransitionSeries.Sequence durationInFrames={sceneFrames}>
                <OffthreadVideo
                  src={scene.url}
                  // Mute — audio comes from the FFmpeg mux step downstream
                  muted
                  // OffthreadVideo handles aspect-ratio differences
                  // gracefully; the canvas is 720x1280 portrait.
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </TransitionSeries.Sequence>
              {/* Transition between this scene and the next */}
              {i < scenes.length - 1 && transitionSec > 0 && (
                <TransitionSeries.Transition
                  presentation={fade()}
                  timing={linearTiming({ durationInFrames: transitionFrames })}
                />
              )}
            </React.Fragment>
          );
        })}
      </TransitionSeries>

      {/* ─── Overlay track: per-scene 3-word texts ────────────────────── */}
      {/* Each overlay carries absolute start/end in seconds — we convert
          to from-frame + durationInFrames here so OverlayText.tsx stays
          pure (only deals with currentFrame within its own sequence). */}
      {overlays.map((ov, i) => {
        const fromFrame = Math.max(0, Math.round(ov.start * fps));
        const durationInFrames = Math.max(
          1,
          Math.round((ov.end - ov.start) * fps),
        );
        return (
          <Sequence
            key={`overlay-${i}-${ov.sceneIndex ?? "x"}-${ov.text.slice(0, 12)}`}
            from={fromFrame}
            durationInFrames={durationInFrames}
          >
            <OverlayText text={ov.text} sceneIndex={ov.sceneIndex} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
