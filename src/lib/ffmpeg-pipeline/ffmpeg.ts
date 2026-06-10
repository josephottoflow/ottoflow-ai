/**
 * FFmpeg filter-graph builder for the multi-agent pipeline.
 *
 * One ffmpeg invocation per video. The filter graph is built from the
 * CompositionPlan's per-scene EditDecisions, then handed to spawn(). The
 * function returns the FULL argv array — callers wrap spawn() themselves
 * so they can attach progress parsers if needed.
 */
import type {
  CompositionPlan,
  EditDecision,
  TimingPlan,
  TransitionKind,
} from "./types";

const ENC = {
  vcodec: "libx264",
  preset: "veryfast",
  crf: 22,
  pixFmt: "yuv420p",
  profile: "high",
  level: "4.0",
  acodec: "aac",
  abitrate: "192k",
};

// ─── Filter-graph builders (small, composable, testable) ───────────────────

/**
 * Build the per-scene normalize + Ken Burns + grade chain.
 * Returns the filter string + the output label.
 */
function buildSceneChain(
  inputIdx: number,
  scene: { timing: TimingPlan; edit: EditDecision },
  width: number,
  height: number,
  fps: number,
): { filter: string; outLabel: string } {
  const durMs = scene.timing.videoEndMs - scene.timing.videoStartMs;
  const durFrames = Math.round((durMs / 1000) * fps);
  const { zoom, grade } = scene.edit;

  // Ken Burns: linear zoom from `zoom.from` to `zoom.to` across the scene.
  // `zoompan` works on a per-frame expression. We use:
  //   z = zoom.from + (zoom.to - zoom.from) * (on / d)
  // where `on` is the current frame index and `d` is total frames.
  const zoomDelta = zoom.to - zoom.from;
  const zExpr =
    `'min(max(${zoom.from.toFixed(3)}+${zoomDelta.toFixed(4)}*on/${durFrames},${zoom.from.toFixed(3)}),${zoom.to.toFixed(3)})'`;

  // x/y track the pan envelope (Agent 10 may set non-centre origins).
  const { pan } = scene.edit;
  const xExpr =
    `'iw*(${pan.fromX.toFixed(3)}+(${pan.toX.toFixed(3)}-${pan.fromX.toFixed(3)})*on/${durFrames})-(iw/zoom/2)'`;
  const yExpr =
    `'ih*(${pan.fromY.toFixed(3)}+(${pan.toY.toFixed(3)}-${pan.fromY.toFixed(3)})*on/${durFrames})-(ih/zoom/2)'`;

  const gradeFilter = gradeFilterFor(grade);

  // The chain:
  //   scale  → cover the 1080x1920 frame (then crop excess)
  //   crop   → exactly 1080x1920
  //   trim   → cap to scene duration so xfade offset math is predictable
  //   zoompan → Ken Burns
  //   eq/lut → colour grade
  //   fps    → FORCE constant frame rate. xfade REQUIRES CFR inputs; source
  //            clips (Pexels etc.) are often VFR, and on the nixpacks Linux
  //            ffmpeg the post-zoompan stream reports rate 1/0 → xfade aborts
  //            with "inputs needs to be a constant frame rate". Local ffmpeg
  //            infers CFR and passed, masking this in dev. The explicit
  //            `fps` filter + fixed timebase makes xfade deterministic.
  //   format → yuv420p so every input shares one pixel format for xfade.
  //   setpts → reset PTS so xfade can align.
  const filter =
    `[${inputIdx}:v]` +
    `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},` +
    `trim=duration=${(durMs / 1000).toFixed(3)},` +
    `zoompan=z=${zExpr}:x=${xExpr}:y=${yExpr}:d=${durFrames}:s=${width}x${height}:fps=${fps},` +
    gradeFilter + "," +
    `fps=${fps},format=yuv420p,settb=AVTB,` +
    `setpts=PTS-STARTPTS` +
    `[v${inputIdx}]`;
  return { filter, outLabel: `v${inputIdx}` };
}

function gradeFilterFor(grade: EditDecision["grade"]): string {
  switch (grade) {
    case "cinematic":
      return "eq=saturation=0.92:contrast=1.10:gamma=0.95";
    case "warm":
      return "eq=saturation=1.08:contrast=1.05:gamma=1.0,colorbalance=rs=0.05:gs=0.0:bs=-0.05";
    case "punchy":
      return "eq=saturation=1.25:contrast=1.15:gamma=1.0";
    case "natural":
    default:
      return "eq=saturation=1.0:contrast=1.0";
  }
}

/**
 * Map our TransitionKind to xfade's `transition` parameter. Falls back to
 * `fade` for anything xfade doesn't natively know.
 */
function xfadeName(kind: TransitionKind): string {
  switch (kind) {
    case "fade":      return "fade";
    case "fadeblack": return "fadeblack";
    case "dissolve":  return "dissolve";
    case "wiperight": return "wiperight";
    case "wipeleft":  return "wipeleft";
    case "cut":       return "fade";        // 0-duration fade ≈ cut; we set duration=0 below
  }
}

/**
 * Chain xfade transitions across N scene labels.
 * Returns the final video output label.
 */
function buildXfadeChain(
  sceneLabels: string[],
  scenes: { timing: TimingPlan; edit: EditDecision }[],
): { filter: string; outLabel: string } {
  if (sceneLabels.length === 0) {
    throw new Error("buildXfadeChain: no scenes");
  }
  if (sceneLabels.length === 1) {
    return { filter: "", outLabel: sceneLabels[0] };
  }

  const parts: string[] = [];
  // Running cumulative duration (in seconds) of the composed video so far.
  // xfade's `offset` is measured from the START of the first input —
  // i.e. where the transition begins on the timeline.
  let cumulativeMs = 0;
  let prev = sceneLabels[0];
  for (let i = 1; i < sceneLabels.length; i++) {
    const inLabel = sceneLabels[i];
    const outLabel = i === sceneLabels.length - 1 ? "vbase" : `x${i}`;
    const sceneDurMs =
      scenes[i - 1].timing.videoEndMs - scenes[i - 1].timing.videoStartMs;
    cumulativeMs += sceneDurMs;
    const edit = scenes[i - 1].edit;
    const transitionDurSec =
      edit.transition === "cut"
        ? 0
        : Math.max(0.05, edit.transitionDurationMs / 1000);
    // xfade's offset is "start of transition" — i.e. cumulative duration
    // of all PRIOR scenes, minus the transition duration so they overlap.
    const offsetSec = Math.max(
      0,
      (cumulativeMs / 1000) - transitionDurSec,
    );
    const name = xfadeName(edit.transition);
    parts.push(
      `[${prev}][${inLabel}]xfade=transition=${name}:duration=${transitionDurSec.toFixed(3)}:offset=${offsetSec.toFixed(3)}[${outLabel}]`,
    );
    prev = outLabel;
  }
  return { filter: parts.join(";"), outLabel: prev };
}

/**
 * Build the audio mix: narration full volume, music ducked dynamically via
 * sidechain compression keyed to narration. If musicUrl is empty, narration
 * goes through alone.
 */
function buildAudioChain(
  narrationInputIdx: number,
  musicInputIdx: number | null,
  duckingDb: number,
): { filter: string; outLabel: string } {
  // narration: pass-through at +0 dB
  if (musicInputIdx === null) {
    // Just rename narration's audio so the -map below is consistent.
    return {
      filter: `[${narrationInputIdx}:a]volume=1.0[aout]`,
      outLabel: "aout",
    };
  }
  // Music linear gain from dB (fallback static volume in case sidechain
  // misbehaves — sidechaincompress overrides this dynamically).
  const musicLinear = Math.pow(10, duckingDb / 20);
  // CRITICAL: normalize BOTH audio streams to an identical format
  // (44.1kHz / fltp / stereo) before sidechaincompress + amix. ElevenLabs
  // narration and Jamendo music MP3s arrive at different sample rates;
  // sidechaincompress (and amix) error out when their inputs don't match.
  // Some ffmpeg builds auto-insert aresample, others (the nixpacks Linux
  // build on Railway) do NOT — which failed prod with `code=234` on the
  // music input while passing locally. Explicit aformat makes the graph
  // deterministic across builds.
  //
  // No looping: Jamendo tracks are full songs (minutes), always longer than
  // a 30-60s video, so `amix=duration=first` already trims to the narration.
  // The old `aloop=loop=-1:size=2e+09` allocated a multi-GB buffer for no
  // benefit and risked OOM on the memory-capped worker.
  const norm = "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo";
  return {
    filter: [
      `[${narrationInputIdx}:a]${norm},volume=1.0,asplit=2[narr_main][narr_key]`,
      `[${musicInputIdx}:a]${norm},volume=${musicLinear.toFixed(3)}[mus]`,
      `[mus][narr_key]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=250[ducked]`,
      `[narr_main][ducked]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
    ].join(";"),
    outLabel: "aout",
  };
}

// ─── Public entry: build the full argv for ffmpeg ──────────────────────────

export interface BuildArgvInput {
  plan: CompositionPlan;
  sceneInputPaths: string[];      // ordered by sceneId
  narrationInputPath: string;     // .mp3
  musicInputPath: string | null;  // .mp3 — null when no music available
  assPath: string;                // captions file
  outputPath: string;             // .mp4
}

export function buildFfmpegArgv(input: BuildArgvInput): string[] {
  const { plan, sceneInputPaths, narrationInputPath, musicInputPath, assPath, outputPath } = input;
  if (sceneInputPaths.length !== plan.scenes.length) {
    throw new Error(
      `buildFfmpegArgv: sceneInputPaths length ${sceneInputPaths.length} != plan.scenes ${plan.scenes.length}`,
    );
  }

  // Input args — N scenes, then narration, then music.
  const inputArgs: string[] = [];
  for (const p of sceneInputPaths) {
    inputArgs.push("-i", p);
  }
  const narrationIdx = sceneInputPaths.length;
  inputArgs.push("-i", narrationInputPath);
  let musicIdx: number | null = null;
  if (musicInputPath) {
    musicIdx = sceneInputPaths.length + 1;
    inputArgs.push("-i", musicInputPath);
  }

  // Per-scene chains.
  const sceneChains: string[] = [];
  const sceneLabels: string[] = [];
  for (let i = 0; i < plan.scenes.length; i++) {
    const built = buildSceneChain(
      i,
      { timing: plan.scenes[i].timing, edit: plan.scenes[i].edit },
      plan.output.width,
      plan.output.height,
      plan.output.fps,
    );
    sceneChains.push(built.filter);
    sceneLabels.push(built.outLabel);
  }

  // xfade chain across scenes.
  const xfade = buildXfadeChain(
    sceneLabels,
    plan.scenes.map((s) => ({ timing: s.timing, edit: s.edit })),
  );
  // ass burn-in on top of the xfaded base.
  // Escape the ASS path for the FFmpeg filter syntax — colons and backslashes
  // must be backslash-escaped because the ass filter splits its options on ":".
  const assPathEscaped = assPath
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
  const assFilter = `[${xfade.outLabel}]ass='${assPathEscaped}'[vout]`;

  // Audio chain.
  const audio = buildAudioChain(narrationIdx, musicIdx, plan.audio.musicDuckingDb);

  const filterComplex = [
    sceneChains.join(";"),
    xfade.filter, // possibly empty
    assFilter,
    audio.filter,
  ]
    .filter((s) => s.length > 0)
    .join(";");

  const totalDurSec = plan.output.durationMs / 1000;

  return [
    "-y",
    ...inputArgs,
    "-filter_complex", filterComplex,
    "-map", `[vout]`,
    "-map", `[${audio.outLabel}]`,
    "-c:v", ENC.vcodec,
    "-preset", ENC.preset,
    "-crf", String(ENC.crf),
    "-pix_fmt", ENC.pixFmt,
    "-profile:v", ENC.profile,
    "-level", ENC.level,
    "-c:a", ENC.acodec,
    "-b:a", ENC.abitrate,
    "-movflags", "+faststart",
    "-r", String(plan.output.fps),
    "-t", totalDurSec.toFixed(3),
    outputPath,
  ];
}
