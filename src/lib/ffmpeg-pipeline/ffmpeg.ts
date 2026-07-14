/**
 * FFmpeg command builders for the multi-agent pipeline — LOW-MEMORY MULTI-PASS.
 *
 * The original single-invocation design decoded all N scenes (1080x1920 H.264)
 * simultaneously inside one filtergraph, which OOM-killed the 1 GB Railway
 * worker (alongside the Node process). This rewrite bounds peak memory to
 * ≤2 concurrent decodes by splitting compose into three passes:
 *
 *   Pass 1 — normalize: ONE ffmpeg per scene. Decodes a single clip, applies
 *            scale/crop/trim/grade and forces CFR, writes a clean silent
 *            1080x1920 H.264 temp clip. Peak = 1 decode + 1 encode.
 *   Pass 2 — fold: pairwise xfade. Start from clip 0, xfade-join clip 1, then
 *            clip 2, … into a running `silent.mp4`. Each step decodes exactly
 *            2 clips. (A 2-decode xfade encode was verified to fit 1 GB in the
 *            prod container; a 4-decode one OOM'd.)
 *   Pass 3 — finalize: burn ASS captions onto the silent video + mix narration
 *            (full) with side-chain-ducked music → final MP4. 1 video + 2 audio
 *            decodes.
 *
 * CRITICAL ffmpeg ordering (proven in the prod nixpacks container):
 *   - `fps` must come AFTER `setpts` — setpts unsets the link frame rate to
 *     1/0, which xfade rejects ("inputs needs to be a constant frame rate").
 *   - `-r <fps>` is set as an INPUT option to force CFR at decode.
 *   - `-threads 2` + `-filter_complex_threads 2` cap parallelism so libx264
 *     (which would otherwise spawn one thread per host CPU — 32+) does not
 *     blow the RAM cap.
 */
import { promises as fs, existsSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { spawn } from "node:child_process";
import { renderAss, type CaptionStyle } from "./ass-captions";
import { resolveRenderFlagsForJob } from "./render-profile";

/**
 * V3 Phase 3 — locate the bundled premium fonts (assets/fonts) for libass
 * `fontsdir`. Existence-checked over candidate roots so it NEVER throws; returns
 * null when not found → the caption renders in DejaVu (graceful fallback, always
 * readable). Only used for Modern (animated) renders; Legacy passes null.
 */
function resolveFontsDir(): string | null {
  const marker = "Sora-Bold.ttf";
  const candidates = [
    pathJoin(process.cwd(), "assets", "fonts"),
    pathJoin(process.cwd(), "ottoflow-ai", "assets", "fonts"),
    pathJoin(__dirname, "..", "..", "..", "assets", "fonts"),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(pathJoin(c, marker))) return c;
    } catch {
      /* ignore and try next */
    }
  }
  return null;
}
import type {
  CompositionPlan,
  EditDecision,
  TimedCaption,
  TimingPlan,
  TransitionKind,
} from "./types";

const ENC = {
  vcodec: "libx264",
  // `ultrafast` is a deliberate MEMORY choice (not speed): it disables
  // B-frames, CABAC, multi-ref, and the lookahead buffer — the structures
  // that dominate libx264 RSS — so each pass fits the 1 GB worker. Quality
  // is fine for short-form vertical at these CRFs. (`veryfast` + threads=2
  // still OOM'd the 1 GB worker.)
  preset: "ultrafast",
  crf: 23,
  intermediateCrf: 20,
  pixFmt: "yuv420p",
  // ultrafast can't honour High profile features; baseline-ish via profile
  // omission is fine. Keep yuv420p for universal playback.
  acodec: "aac",
  abitrate: "192k",
} as const;

// Shared thread/memory caps applied to every pass.
//   -threads 2          : libx264 encoder threads (host shows 32 CPUs).
//   -filter*_threads 1  : single filter thread — each filter thread holds
//                         its own 1080x1920 frame buffers; on a 1 GB worker
//                         we trade a little speed for a much smaller peak.
const THREAD_CAP = [
  "-threads", "2",
  "-filter_complex_threads", "1",
  "-filter_threads", "1",
] as const;

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

/** Map our TransitionKind to xfade's `transition` parameter. */
function xfadeName(kind: TransitionKind): string {
  switch (kind) {
    case "fade":      return "fade";
    case "fadeblack": return "fadeblack";
    case "dissolve":  return "dissolve";
    case "wiperight": return "wiperight";
    case "wipeleft":  return "wipeleft";
    case "cut":       return "fade"; // near-instant via short duration below
  }
}

/** Escape a filesystem path for use inside an ffmpeg filter argument. */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

// ─── Pass 1: normalize one scene → clean CFR 1080x1920 silent clip ──────────

export interface NormalizeArgvInput {
  inputPath: string;
  timing: TimingPlan;
  edit: EditDecision;
  width: number;
  height: number;
  fps: number;
  outputPath: string;
  /**
   * Brand grade filter (Visual World V1). When set, replaces the per-scene
   * enum grade so every clip gets the identical deterministic look. Absent →
   * the existing `gradeFilterFor(edit.grade)` enum behaviour is unchanged.
   */
  gradeOverride?: string;
}

export function buildNormalizeArgv(i: NormalizeArgvInput): string[] {
  const durSec = (i.timing.videoEndMs - i.timing.videoStartMs) / 1000;
  const vf =
    `scale=${i.width}:${i.height}:force_original_aspect_ratio=increase,` +
    `crop=${i.width}:${i.height},` +
    `trim=duration=${durSec.toFixed(3)},` +
    `${i.gradeOverride ?? gradeFilterFor(i.edit.grade)},` +
    // fps AFTER setpts — see file header.
    `format=yuv420p,setpts=PTS-STARTPTS,fps=${i.fps}`;
  return [
    "-y",
    ...THREAD_CAP,
    "-r", String(i.fps),
    "-i", i.inputPath,
    "-vf", vf,
    "-an",
    "-c:v", ENC.vcodec,
    "-preset", ENC.preset,
    "-crf", String(ENC.intermediateCrf),
    "-pix_fmt", ENC.pixFmt,
    "-r", String(i.fps),
    "-t", durSec.toFixed(3),
    "-movflags", "+faststart",
    i.outputPath,
  ];
}

// ─── Pass 2: xfade two already-normalized clips → one clip ──────────────────

export interface XfadeArgvInput {
  aPath: string;
  bPath: string;
  transition: TransitionKind;
  transitionDurationMs: number;
  /** Seconds into the COMBINED timeline where the transition starts. */
  offsetSec: number;
  fps: number;
  outputPath: string;
}

export function buildXfadeArgv(i: XfadeArgvInput): string[] {
  const transDur = i.transition === "cut" ? 0.1 : Math.max(0.1, i.transitionDurationMs / 1000);
  const name = xfadeName(i.transition);
  // Both inputs are already normalized CFR clips; re-assert format/setpts/fps
  // (fps last) so xfade sees a constant rate regardless of decode quirks.
  const filter =
    `[0:v]format=yuv420p,setpts=PTS-STARTPTS,fps=${i.fps}[a];` +
    `[1:v]format=yuv420p,setpts=PTS-STARTPTS,fps=${i.fps}[b];` +
    `[a][b]xfade=transition=${name}:duration=${transDur.toFixed(3)}:offset=${i.offsetSec.toFixed(3)}[v]`;
  return [
    "-y",
    ...THREAD_CAP,
    "-r", String(i.fps), "-i", i.aPath,
    "-r", String(i.fps), "-i", i.bPath,
    "-filter_complex", filter,
    "-map", "[v]",
    "-an",
    "-c:v", ENC.vcodec,
    "-preset", ENC.preset,
    "-crf", String(ENC.intermediateCrf),
    "-pix_fmt", ENC.pixFmt,
    "-r", String(i.fps),
    "-movflags", "+faststart",
    i.outputPath,
  ];
}

// ─── Pass 2 (final): concat-join the scenes (zero decode) + captions + audio ─

export interface FinalizeArgvInput {
  /** Path to a concat-demuxer list file referencing the normalized clips. */
  concatListPath: string;
  assPath: string;
  /** Optional (Video V1 AI-first scenes may have no narration → silent/music-only). */
  narrationInputPath: string | null;
  musicInputPath: string | null;
  musicDuckingDb: number;
  /** Optional brand logo PNG overlaid bottom-right (Video V1 branding). */
  logoPath?: string | null;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  outputPath: string;
  /** Per-render audio-mix profile (Video Quality V2). true = v2 broadcast master
   * (loudnorm + smoother duck); false/undefined = Legacy graph (byte-identical).
   * Passed EXPLICITLY per render by composeMultiPass — no global default. */
  audioMixV2?: boolean;
  /** V3 Phase 3 — bundled premium-font directory for libass `fontsdir` (Modern
   * only). null/undefined → not added → Legacy byte-identical (DejaVu). */
  fontsDir?: string | null;
}

// ─── Sprint 45 (Audio Timing): assemble per-scene narration on one timeline ──
// Cheap audio-only pass (no video decode): each scene's voice line is delayed
// to its scene's MEASURED start offset, then all lines are mixed into a single
// narration track. The finalize pass consumes it exactly like the legacy
// whole-file narration, so the ducking graph is unchanged.

export interface TimedNarrationArgvInput {
  /** Ordered segments with their absolute placement on the combined timeline. */
  segments: { path: string; delayMs: number }[];
  /** WAV output (pcm) — avoids a lossy re-encode before the final AAC mux. */
  outputPath: string;
}

export function buildTimedNarrationArgv(i: TimedNarrationArgvInput): string[] {
  const norm = "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo";
  const inputArgs = i.segments.flatMap((s) => ["-i", s.path]);
  const chains = i.segments
    .map(
      (s, k) =>
        `[${k}:a]${norm},adelay=${Math.max(0, Math.round(s.delayMs))}:all=1[s${k}]`,
    )
    .join(";");
  const labels = i.segments.map((_, k) => `[s${k}]`).join("");
  // normalize=0: segments occupy disjoint windows, so no summing headroom is
  // needed — keep each line at full voice level.
  const filter = `${chains};${labels}amix=inputs=${i.segments.length}:duration=longest:normalize=0[aout]`;
  return [
    "-y",
    ...THREAD_CAP,
    ...inputArgs,
    "-filter_complex", filter,
    "-map", "[aout]",
    "-c:a", "pcm_s16le",
    i.outputPath,
  ];
}

export function buildFinalizeArgv(i: FinalizeArgvInput): string[] {
  // Input 0 = the concat demuxer: presents all normalized clips as ONE
  // continuous video stream, so only ONE decode runs at a time (vs xfade's
  // two) — what fits the 1 GB worker. Audio/logo inputs are appended and
  // referenced by computed index so optional inputs don't shift each other.
  const inputArgs: string[] = ["-f", "concat", "-safe", "0", "-i", i.concatListPath];
  let idx = 1;
  let narrIdx = -1;
  let musIdx = -1;
  let logoIdx = -1;
  if (i.narrationInputPath) {
    inputArgs.push("-i", i.narrationInputPath);
    narrIdx = idx++;
  }
  if (i.musicInputPath) {
    // Sprint 45 (Music Mix): short tracks are looped so the bed covers the
    // FULL video. Sprint 50 (Music Continuity): looping moved from
    // `-stream_loop -1` (demuxer level) to the `aloop` filter AFTER
    // tail-trimming (MUSIC_LOOP_PREP below) — the trim filters need a FINITE
    // input (areverse buffers to EOF), and looping an untrimmed track rode
    // straight through its natural fade-out tail (prod 917794e4 / b452b393:
    // ~3s of dead air at every loop boundary).
    inputArgs.push("-i", i.musicInputPath);
    musIdx = idx++;
  }
  if (i.logoPath) {
    // `-loop 1` makes the still logo an infinite stream so the overlay always
    // has a frame for the full video; `shortest=1` (below) then bounds the
    // output to the main video's length. (A single-frame image + eof_action
    // is version-dependent on the prod nixpacks ffmpeg — this is deterministic.)
    inputArgs.push("-loop", "1", "-i", i.logoPath);
    logoIdx = idx++;
  }

  // ─── Video: burn captions, then (optional) overlay the logo bottom-right ──
  // V3 Phase 3: add libass `fontsdir` ONLY when a Modern render supplies it, so
  // the ass-filter string (and thus the output) is byte-identical for Legacy.
  const assFilter = `ass='${escapeFilterPath(i.assPath)}'${
    i.fontsDir ? `:fontsdir='${escapeFilterPath(i.fontsDir)}'` : ""
  }`;
  let videoFilter: string;
  if (logoIdx >= 0) {
    // Size the logo to the SHORT edge so it occupies a consistent fraction of
    // the frame on EVERY aspect. min(W,H) keeps the certified 9:16 byte-identical
    // (min(1080,1920)=1080 → 238px, exactly the old width*0.22) while preventing
    // the bug from ballooning to 22% of the 1920px LONG edge on 16:9 (FMEA #1,
    // RPN 126 — oversized corner logo on landscape).
    const logoW = Math.round(Math.min(i.width, i.height) * 0.22);
    const marginX = Math.round(i.width * 0.05);
    const marginY = Math.round(i.height * 0.04);
    videoFilter =
      `[0:v]${assFilter}[base];` +
      `[${logoIdx}:v]scale=${logoW}:-1[lg];` +
      `[base][lg]overlay=W-w-${marginX}:H-h-${marginY}:shortest=1[vout]`;
  } else {
    videoFilter = `[0:v]${assFilter}[vout]`;
  }

  // ─── Audio: narration full; music side-chain ducked when both present;
  //     music-only or silent supported for the AI-first path. ───────────────
  const norm = "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo";
  // Sprint 45 (Music Mix): musical fade-in at the top, fade-out into the end.
  const fadeOutStart = Math.max(0, i.durationSec - 2).toFixed(3);
  const musicFades = `afade=t=in:st=0:d=1.0,afade=t=out:st=${fadeOutStart}:d=2.0`;
  // Sprint 50 (Music Continuity) — ROOT CAUSE (repro'd locally with prod track
  // 1522018, 25.42s vs a 30s video): stock tracks end in a natural fade-to-
  // silence tail (−13→−70dB over the last ~4s) and open with a quiet intro;
  // looping an untrimmed track produced ~3s of dead air at every loop boundary
  // (prod gaps: 917794e4 2.89s @23.1s, b452b393 3.04s @24.3s — silence starts
  // exactly where the attenuated tail crosses −45dB). Fix, proven offline on
  // the exact failing track (silence 3.11s → NONE at −45dB/1s and −40dB/0.75s):
  //   1. silenceremove(head)  — strip true leading silence,
  //   2. areverse + silenceremove(−30dB) + areverse — strip the fade tail
  //      (−30dB keeps the bed ≥ ~−42dB after the −12dB mix attenuation),
  //   3. aloop=−1 — loop the TRIMMED bed (INT32_MAX-sample window ≈ 13.5h cap).
  // Tracks longer than the video and tracks without tails pass through
  // unchanged; a pathological all-silent track degrades to no bed (same as
  // the existing music-absent path). Ducking, fades, narration untouched.
  const MUSIC_LOOP_PREP =
    "silenceremove=start_periods=1:start_threshold=-45dB," +
    "areverse,silenceremove=start_periods=1:start_threshold=-30dB,areverse," +
    "aloop=loop=-1:size=2147483647";
  // Audio Mix V2 (AUDIO_MIX_PROFILE): broadcast mastering + a touch smoother
  // ducking. Default (unset/v1) emits the EXACT legacy graph below (byte-
  // identical, certified). v2 appends loudnorm (EBU R128 −14 LUFS / −1.5 dBTP,
  // the social-platform target) so every export lands at a consistent premium
  // loudness, and softens the sidechain (threshold 0.05→0.04, release 250→300)
  // for a cleaner voice-over-music recovery. Same FFmpeg, no new dependency.
  // Per-render flag wins; AUDIO_MIX_PROFILE is a dev-only override used only when
  // the composer passes no explicit flag. Neither → Legacy graph (byte-identical).
  const mixMode = (process.env.AUDIO_MIX_PROFILE ?? "").trim().toLowerCase();
  const audioMixV2 =
    i.audioMixV2 === true ||
    (i.audioMixV2 === undefined && ["v2", "modern", "premium"].includes(mixMode));
  const MASTER = audioMixV2 ? ",loudnorm=I=-14:TP=-1.5:LRA=11" : "";
  const duck = audioMixV2
    ? "sidechaincompress=threshold=0.04:ratio=8:attack=20:release=300"
    : "sidechaincompress=threshold=0.05:ratio=8:attack=20:release=250";
  let audioFilter: string | null = null;
  let audioOut: string | null = null;
  if (narrIdx >= 0 && musIdx >= 0) {
    const musicLinear = Math.pow(10, i.musicDuckingDb / 20);
    // apad BEFORE the split: both the mix branch and the ducking key run the
    // full video length, so the (looped, faded) music keeps playing after the
    // last narration line instead of the mix ending with the voice — the
    // output is bounded by `-t`. normalize=0 keeps the voice at full level
    // (music is already pre-attenuated + side-chain ducked); the limiter
    // guards the summed peaks against clipping.
    audioFilter =
      `[${narrIdx}:a]${norm},volume=1.0,apad,asplit=2[narr_main][narr_key];` +
      `[${musIdx}:a]${norm},${MUSIC_LOOP_PREP},volume=${musicLinear.toFixed(3)},${musicFades}[mus];` +
      `[mus][narr_key]${duck}[ducked];` +
      `[narr_main][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95${MASTER}[aout]`;
    audioOut = "[aout]";
  } else if (narrIdx >= 0) {
    audioFilter = `[${narrIdx}:a]${norm},volume=1.0${MASTER}[aout]`;
    audioOut = "[aout]";
  } else if (musIdx >= 0) {
    audioFilter = `[${musIdx}:a]${norm},${MUSIC_LOOP_PREP},volume=1.0,${musicFades}${MASTER}[aout]`;
    audioOut = "[aout]";
  }
  // else: no audio inputs → silent video (no audio map / codec).

  const filterComplex = audioFilter ? `${videoFilter};${audioFilter}` : videoFilter;

  const argv: string[] = [
    "-y",
    ...THREAD_CAP,
    ...inputArgs,
    "-filter_complex", filterComplex,
    "-map", "[vout]",
  ];
  if (audioOut) {
    argv.push("-map", audioOut, "-c:a", ENC.acodec, "-b:a", ENC.abitrate);
  }
  argv.push(
    "-c:v", ENC.vcodec,
    "-preset", ENC.preset,
    "-crf", String(ENC.crf),
    "-pix_fmt", ENC.pixFmt,
    "-movflags", "+faststart",
    "-r", String(i.fps),
    "-t", i.durationSec.toFixed(3),
    i.outputPath,
  );
  return argv;
}

// ─── CTA end card: a still PNG → short CFR clip matching the normalized
//     scenes, so it concatenates seamlessly as the final "scene". ───────────

export interface CtaCardClipArgvInput {
  pngPath: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  outputPath: string;
}

export function buildCtaCardClipArgv(i: CtaCardClipArgvInput): string[] {
  const vf =
    `scale=${i.width}:${i.height}:force_original_aspect_ratio=increase,` +
    `crop=${i.width}:${i.height},` +
    `format=yuv420p,setpts=PTS-STARTPTS,fps=${i.fps}`;
  return [
    "-y",
    ...THREAD_CAP,
    "-loop", "1",
    "-r", String(i.fps),
    "-t", i.durationSec.toFixed(3),
    "-i", i.pngPath,
    "-vf", vf,
    "-an",
    "-c:v", ENC.vcodec,
    "-preset", ENC.preset,
    "-crf", String(ENC.intermediateCrf),
    "-pix_fmt", ENC.pixFmt,
    "-r", String(i.fps),
    "-t", i.durationSec.toFixed(3),
    "-movflags", "+faststart",
    i.outputPath,
  ];
}

// ─── Orchestrator: normalize each scene (1 decode), then concat-join +
//     caption + mix in one finalize pass (1 decode). Never >1 decode at once,
//     so it fits the 1 GB worker. (Crossfades need 2 simultaneous decodes,
//     which OOM 1 GB — they return when the worker has more RAM.) ────────────

export interface MultiPassInput {
  plan: CompositionPlan;
  /** Ordered by sceneId — the downloaded source clip for each scene. */
  sceneInputPaths: string[];
  /** Optional: AI-first scenes-only videos may be silent / music-only. */
  narrationInputPath: string | null;
  /** Sprint 45 (Audio Timing) — per-scene voice lines. When present, they are
   *  assembled into ONE narration track placed at each scene's MEASURED start
   *  offset (same measurement the caption clamp uses) and take precedence over
   *  narrationInputPath. Assembly failure falls back to narrationInputPath. */
  narrationSegmentPaths?: { sceneId: number; path: string }[] | null;
  musicInputPath: string | null;
  /** Where to WRITE the rendered ASS captions file. */
  assPath: string;
  /** Scene captions — rendered to ASS INSIDE composeMultiPass AFTER the actual
   *  normalized scene durations are measured, so the track is clamped to the real
   *  scenes-end and can't bleed onto the appended CTA card (the per-scene `-r`
   *  input speeds 24fps clips to 30fps → scenes play shorter than their planned,
   *  caption-timed durations). Optional — defaults to `plan.scenes[].caption`. */
  captions?: TimedCaption[];
  captionStyle?: CaptionStyle;
  /** Optional brand logo PNG overlaid bottom-right (Video V1 branding). */
  logoPath?: string | null;
  /** Optional CTA end card (already rendered PNG) appended as the last clip. */
  ctaCard?: { pngPath: string; durationSec: number } | null;
  workDir: string;
  outputPath: string;
  /** Runs ffmpeg; MUST reject on non-zero exit. `label` is for logging. */
  runFfmpeg: (argv: string[], label: string) => Promise<void>;
  /** Optional progress callback 0..1 across the passes. */
  onProgress?: (fraction: number) => void;
}

/** ffprobe a clip's container duration in seconds; resolves 0 on any failure. */
function probeDurationSec(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let out = "";
    p.stdout.on("data", (c) => (out += c.toString()));
    p.on("close", () => {
      const n = Number(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? n : 0);
    });
    p.on("error", () => resolve(0));
  });
}

export async function composeMultiPass(input: MultiPassInput): Promise<void> {
  const { plan, sceneInputPaths, workDir } = input;
  // Per-render presentation flags (Video Quality V2). Resolved from THIS job's
  // renderProfile ONLY — Modern is strictly opt-in per render, never global. We
  // pass {} as the env so RENDER_PROFILE_DEFAULT can never activate Modern
  // globally. Absent/legacy profile → Legacy flags → byte-identical output.
  const renderFlags = resolveRenderFlagsForJob(plan.renderProfile);
  const fps = plan.output.fps;
  const W = plan.output.width;
  const H = plan.output.height;
  const n = plan.scenes.length;
  if (sceneInputPaths.length !== n) {
    throw new Error(
      `composeMultiPass: ${sceneInputPaths.length} clips != ${n} scenes`,
    );
  }
  const join = (name: string) => `${workDir}/${name}`;
  // Visual World V1 brand grade: one deterministic eq applied to every clip
  // (overrides the per-scene enum grade). Cheap single-filter — no extra decode,
  // no memory cost vs the enum grade it replaces.
  const bg = plan.branding?.grade;
  const gradeOverride = bg
    ? `eq=contrast=${bg.contrast}:saturation=${bg.saturation}:brightness=${bg.brightness}`
    : undefined;
  const hasCta = !!input.ctaCard;
  const totalSteps = n /* normalize */ + (hasCta ? 1 : 0) /* cta clip */ + 1 /* finalize */;
  let step = 0;
  const tick = () => input.onProgress?.(++step / totalSteps);

  // ── Pass 1: normalize each scene (1 decode each) ──────────────────────────
  const normPaths: string[] = [];
  for (let k = 0; k < n; k++) {
    const out = join(`norm-${k}.mp4`);
    await input.runFfmpeg(
      buildNormalizeArgv({
        inputPath: sceneInputPaths[k],
        timing: plan.scenes[k].timing,
        edit: plan.scenes[k].edit,
        width: W, height: H, fps,
        outputPath: out,
        gradeOverride,
      }),
      `normalize-${k}`,
    );
    normPaths.push(out);
    tick();
  }

  // ── Caption clamp (endcard overlap fix) ───────────────────────────────────
  // normPaths currently holds the SCENE clips only (CTA card appended below).
  // Measure their ACTUAL durations — each plays back shorter than its planned,
  // caption-timed duration because the per-scene `-r <fps>` input re-times a
  // 24fps Seedance clip as 30fps. Clamp every caption to end at the real
  // scenes-end and drop any caption starting past it, so no caption can render
  // over the CTA end card. Scene/total/CTA timing are unchanged. Fail-safe: if
  // a probe returns 0, fall back to the planned total (original behaviour).
  const measured = await Promise.all(normPaths.map(probeDurationSec));
  const measuredScenesSec = measured.reduce((a, d) => a + d, 0);
  const scenesEndMs =
    measuredScenesSec > 0 ? Math.round(measuredScenesSec * 1000) : plan.output.durationMs;
  const captions = input.captions ?? plan.scenes.map((s) => s.caption);
  const clampedCaptions = captions
    .filter((c) => c.startMs < scenesEndMs)
    .map((c) => ({ ...c, endMs: Math.min(c.endMs, scenesEndMs) }));
  await fs.writeFile(
    input.assPath,
    renderAss(clampedCaptions, input.captionStyle, { width: W, height: H }, {
      captionEngine: renderFlags.captionEngine,
      captionStyle: renderFlags.captionStyle,
      // Brand accent → OttoFlow marigold fallback ONLY (never hardcoded default).
      accentColor: plan.branding?.palette?.accent || "#E9863B",
    }),
    "utf-8",
  );

  // ── Sprint 45 (Audio Timing): scene-timed narration ───────────────────────
  // Place each scene's voice line at that scene's MEASURED start offset (the
  // same measurement the caption clamp above uses), assembled into one track
  // by a cheap audio-only pass. Falls back to the legacy whole-file narration
  // (or silence) on any failure — never fails the render.
  let narrationInputPath = input.narrationInputPath;
  if (input.narrationSegmentPaths?.length) {
    try {
      const probeFailed = measured.some((d) => d <= 0);
      const startMsBySceneId = new Map<number, number>();
      let cursorMs = 0;
      for (let k = 0; k < n; k++) {
        const sceneId = plan.scenes[k].plan.sceneId;
        // Probe fallback: planned caption start (original timeline) — keeps
        // voice and captions on the SAME clock either way.
        startMsBySceneId.set(
          sceneId,
          probeFailed ? plan.scenes[k].caption.startMs : Math.round(cursorMs),
        );
        cursorMs += measured[k] * 1000;
      }
      const segments = input.narrationSegmentPaths
        .filter((s) => startMsBySceneId.has(s.sceneId))
        .map((s) => ({ path: s.path, delayMs: startMsBySceneId.get(s.sceneId)! }));
      if (segments.length > 0) {
        const timedPath = join("narration-timed.wav");
        await input.runFfmpeg(
          buildTimedNarrationArgv({ segments, outputPath: timedPath }),
          "narration-timing",
        );
        narrationInputPath = timedPath;
      }
    } catch {
      // Keep the legacy narrationInputPath fallback (possibly null).
    }
  }

  // ── Optional: render the CTA end card into a clip appended last. ──────────
  let extraDurationSec = 0;
  if (input.ctaCard) {
    const ctaOut = join("cta-card.mp4");
    await input.runFfmpeg(
      buildCtaCardClipArgv({
        pngPath: input.ctaCard.pngPath,
        durationSec: input.ctaCard.durationSec,
        width: W, height: H, fps,
        outputPath: ctaOut,
      }),
      "cta-card",
    );
    normPaths.push(ctaOut);
    extraDurationSec = input.ctaCard.durationSec;
    tick();
  }

  // ── Write the concat-demuxer list (single-quote-escaped absolute paths). ──
  const concatListPath = join("concat-list.txt");
  const listBody =
    normPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
  await fs.writeFile(concatListPath, listBody, "utf-8");

  // ── Pass 2 (final): concat-join (0 decode) + captions + audio + logo ──────
  await input.runFfmpeg(
    buildFinalizeArgv({
      concatListPath,
      assPath: input.assPath,
      narrationInputPath,
      musicInputPath: input.musicInputPath,
      musicDuckingDb: plan.audio.musicDuckingDb,
      logoPath: input.logoPath ?? null,
      width: W, height: H, fps,
      durationSec: plan.output.durationMs / 1000 + extraDurationSec,
      outputPath: input.outputPath,
      audioMixV2: renderFlags.audioMixProfile === "v2",
      // Premium fonts only when captions are animated (Modern); Legacy → null.
      fontsDir: renderFlags.captionEngine === "animated" ? resolveFontsDir() : null,
    }),
    "finalize",
  );
  tick();
}
