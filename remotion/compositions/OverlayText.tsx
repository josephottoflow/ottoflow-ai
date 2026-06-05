/**
 * Per-scene animated text overlay — Remotion port of buildDrawtextChain
 * (worker/processors/video-merge.ts:149-193).
 *
 * Same animation contract:
 *   - Position rotates by sceneIndex through 5 presets
 *   - Scale pop: 1.2x → 1.0x over the first 150ms
 *   - Alpha envelope: fade in 150ms, hold, fade out 150ms
 *
 * Difference vs FFmpeg drawtext: this is a typed React component you can
 * inspect in <Player />, hot-reload in `npm run studio`, and snapshot-test.
 */
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

const POSITIONS: { top: string; translateY: string }[] = [
  { top: "18%", translateY: "0%" },      // scene 1 — top-third
  { top: "50%", translateY: "-50%" },    // scene 2 — true center
  { top: "65%", translateY: "0%" },      // scene 3 — lower-third (legacy default)
  { top: "78%", translateY: "0%" },      // scene 4 — very low (above TikTok UI)
  { top: "40%", translateY: "0%" },      // scene 5 — upper-middle
];

export const OverlayText: React.FC<{
  text: string;
  sceneIndex?: number;
}> = ({ text, sceneIndex }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Pick the y-position preset. sceneIndex undefined → lower-third default.
  const idx = sceneIndex == null || sceneIndex < 1
    ? 2 // legacy default = scene 3 slot = h*0.65
    : (sceneIndex - 1) % POSITIONS.length;
  const pos = POSITIONS[idx];

  // Animation timings (in frames)
  const popFrames = Math.max(1, Math.round(0.15 * fps));

  // Scale: 1.2 → 1.0 over first 150ms, then hold at 1.0
  const scale = interpolate(
    frame,
    [0, popFrames],
    [1.2, 1.0],
    { extrapolateRight: "clamp" },
  );

  // Alpha: fade in 150ms, hold, fade out 150ms before the sequence ends
  const fadeIn = interpolate(
    frame,
    [0, popFrames],
    [0, 1],
    { extrapolateRight: "clamp" },
  );
  const fadeOut = interpolate(
    frame,
    [Math.max(0, durationInFrames - popFrames), durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = Math.min(fadeIn, fadeOut);

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: pos.top,
          transform: `translate(-50%, ${pos.translateY}) scale(${scale})`,
          // White uppercase body with thick black border + soft drop shadow.
          // Matches drawtext borderw=4 + shadowx=4 shadowy=6 shadowcolor=black@0.6.
          color: "white",
          fontFamily:
            'system-ui, "Helvetica Neue", "DejaVu Sans", "Arial Black", sans-serif',
          fontWeight: 900,
          fontSize: 92, // ~720 * 0.085 → matches the FFmpeg baseSize math at 1080 cap
          letterSpacing: "0.02em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          // Layered text-shadow: 4 cardinals at ±4px act as the borderw=4
          // outline; the offset 4,6 shadow with 0.6 alpha matches drawtext.
          textShadow: [
            "-4px -4px 0 #000",
            "4px -4px 0 #000",
            "-4px 4px 0 #000",
            "4px 4px 0 #000",
            "4px 6px 12px rgba(0,0,0,0.6)",
          ].join(", "),
          opacity,
          // Disable subpixel rounding so the scale-pop reads as crisp
          willChange: "transform, opacity",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
