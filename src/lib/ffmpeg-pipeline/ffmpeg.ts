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
  const { grade } = scene.edit;
  const gradeFilter = gradeFilterFor(grade);

  // NO zoompan. Three prod deploys proved zoompan is the root of the
  // `[xfade] inputs needs to be a constant frame rate; current rate of 1/0`
  // failure on the nixpacks Linux ffmpeg: zoompan is an IMAGE Ken-Burns
  // filter, and run over VIDEO inputs (d = scene-frame-count per input frame)
  // it corrupts the output frame-rate metadata to 1/0 — which xfade rejects,
  // and which no downstream fps/`-r`/settb could override. Local gyan ffmpeg
  // tolerated it, masking it in dev.
  //
  // It was also redundant: the scenes are real moving stock-video clips, so
  // the video is already dynamic without an added zoom. Dropping zoompan
  // guarantees constant frame rate into xfade. (Ken Burns can be re-added
  // later via a CFR-safe method — see scene.edit.zoom/pan, still planned by
  // Agent 10 but currently unused at the FFmpeg layer.)
  //
  // The chain:
  //   scale  → cover the 1080x1920 frame (then crop excess)
  //   crop   → exactly 1080x1920
  //   trim   → cap to scene duration so xfade offset math is predictable
  //   eq/lut → colour grade
  //   format → yuv420p so every input shares one pixel format for xfade
  //   setpts → reset PTS to 0 so xfade's absolute `offset` math aligns
  //   fps    → MUST come LAST, after setpts. Proven in the prod container:
  //            `setpts` unsets the link frame rate to 1/0, and xfade rejects
  //            it ("inputs needs to be a constant frame rate"). Re-asserting
  //            `fps` AFTER setpts restores a constant rate xfade accepts.
  //            (fps-before-setpts — the obvious order — FAILS; that cost
  //            several prod cycles before bisecting it in the Railway console.)
  //            Paired with the input-level `-r <fps>` for VFR sources.
  const filter =
    `[${inputIdx}:v]` +
    `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},` +
    `trim=duration=${(durMs / 1000).toFixed(3)},` +
    gradeFilter + "," +
    `format=yuv420p,setpts=PTS-STARTPTS,fps=${fps}` +
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
  //
  // `-r <fps>` BEFORE each scene `-i` forces constant frame rate at the
  // DECODE level, which sets the stream's r_frame_rate (base rate). This is
  // what `xfade` actually inspects — the post-zoompan `fps` filter only sets
  // the link's frame_rate, leaving r_frame_rate as 1/0 (undefined) on the
  // nixpacks ffmpeg, which xfade rejects with "inputs needs to be a constant
  // frame rate". Forcing it at input is the reliable cross-build fix.
  const inputArgs: string[] = [];
  for (const p of sceneInputPaths) {
    inputArgs.push("-r", String(plan.output.fps), "-i", p);
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
    // Cap filtergraph parallelism. Without this, ffmpeg fans the filter
    // chain across all host CPUs, each holding 1080x1920 frame buffers.
    "-filter_complex_threads", "2",
    "-filter_threads", "2",
    ...inputArgs,
    "-filter_complex", filterComplex,
    "-map", `[vout]`,
    "-map", `[${audio.outLabel}]`,
    "-c:v", ENC.vcodec,
    // CAP ENCODER THREADS. The Railway worker container reports ~60 host
    // CPUs, so libx264 auto-spawned threads=60 — each with per-thread
    // 1080x1920 frame + lookahead buffers — which OOM-killed the process
    // (SIGKILL at frame 0) under the worker's RAM cap. 2 threads keeps peak
    // memory well under the cap; a 30s clip still encodes in seconds at
    // `veryfast`. Memory-safety over raw speed (ADR-002 priority).
    "-threads", "2",
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
