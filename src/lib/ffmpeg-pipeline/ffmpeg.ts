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
  // Slightly higher quality on the intermediate clips so the 3 encode
  // generations (normalize → fold → finalize) don't visibly compound.
  intermediateCrf: 20,
  pixFmt: "yuv420p",
  profile: "high",
  level: "4.0",
  acodec: "aac",
  abitrate: "192k",
} as const;

// Shared thread/memory caps applied to every pass.
const THREAD_CAP = [
  "-threads", "2",
  "-filter_complex_threads", "2",
  "-filter_threads", "2",
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
}

export function buildNormalizeArgv(i: NormalizeArgvInput): string[] {
  const durSec = (i.timing.videoEndMs - i.timing.videoStartMs) / 1000;
  const vf =
    `scale=${i.width}:${i.height}:force_original_aspect_ratio=increase,` +
    `crop=${i.width}:${i.height},` +
    `trim=duration=${durSec.toFixed(3)},` +
    `${gradeFilterFor(i.edit.grade)},` +
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
    "-profile:v", ENC.profile,
    "-level", ENC.level,
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
    "-profile:v", ENC.profile,
    "-level", ENC.level,
    "-r", String(i.fps),
    "-movflags", "+faststart",
    i.outputPath,
  ];
}

// ─── Pass 3: finalize — burn captions + mix audio onto the silent video ─────

export interface FinalizeArgvInput {
  silentVideoPath: string;
  assPath: string;
  narrationInputPath: string;
  musicInputPath: string | null;
  musicDuckingDb: number;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  outputPath: string;
}

export function buildFinalizeArgv(i: FinalizeArgvInput): string[] {
  const assFilter = `[0:v]ass='${escapeFilterPath(i.assPath)}'[vout]`;

  // Audio: narration full volume; music (if any) side-chain ducked. Normalize
  // both to 44.1k/fltp/stereo first so sidechaincompress/amix inputs match.
  const norm = "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo";
  let audioFilter: string;
  let audioOut: string;
  const inputArgs: string[] = [
    "-r", String(i.fps), "-i", i.silentVideoPath,
    "-i", i.narrationInputPath,
  ];
  if (i.musicInputPath) {
    inputArgs.push("-i", i.musicInputPath);
    const musicLinear = Math.pow(10, i.musicDuckingDb / 20);
    audioFilter =
      `[1:a]${norm},volume=1.0,asplit=2[narr_main][narr_key];` +
      `[2:a]${norm},volume=${musicLinear.toFixed(3)}[mus];` +
      `[mus][narr_key]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=250[ducked];` +
      `[narr_main][ducked]amix=inputs=2:duration=first:dropout_transition=0[aout]`;
    audioOut = "[aout]";
  } else {
    audioFilter = `[1:a]${norm},volume=1.0[aout]`;
    audioOut = "[aout]";
  }

  return [
    "-y",
    ...THREAD_CAP,
    ...inputArgs,
    "-filter_complex", `${assFilter};${audioFilter}`,
    "-map", "[vout]",
    "-map", audioOut,
    "-c:v", ENC.vcodec,
    "-preset", ENC.preset,
    "-crf", String(ENC.crf),
    "-pix_fmt", ENC.pixFmt,
    "-profile:v", ENC.profile,
    "-level", ENC.level,
    "-c:a", ENC.acodec,
    "-b:a", ENC.abitrate,
    "-movflags", "+faststart",
    "-r", String(i.fps),
    "-t", i.durationSec.toFixed(3),
    i.outputPath,
  ];
}

// ─── Orchestrator: run the three passes, ≤2 concurrent decodes throughout ───

export interface MultiPassInput {
  plan: CompositionPlan;
  /** Ordered by sceneId — the downloaded source clip for each scene. */
  sceneInputPaths: string[];
  narrationInputPath: string;
  musicInputPath: string | null;
  assPath: string;
  workDir: string;
  outputPath: string;
  /** Runs ffmpeg; MUST reject on non-zero exit. `label` is for logging. */
  runFfmpeg: (argv: string[], label: string) => Promise<void>;
  /** Optional progress callback 0..1 across the passes. */
  onProgress?: (fraction: number) => void;
}

export async function composeMultiPass(input: MultiPassInput): Promise<void> {
  const { plan, sceneInputPaths, workDir } = input;
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
  const totalSteps = n /* normalize */ + Math.max(0, n - 1) /* folds */ + 1 /* finalize */;
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
      }),
      `normalize-${k}`,
    );
    normPaths.push(out);
    tick();
  }

  // ── Pass 2: pairwise xfade fold (2 decodes per step) ──────────────────────
  let acc = normPaths[0];
  let accDurSec = (plan.scenes[0].timing.videoEndMs - plan.scenes[0].timing.videoStartMs) / 1000;
  for (let k = 1; k < n; k++) {
    const prevEdit = plan.scenes[k - 1].edit; // outgoing transition of the left clip
    const transDur = prevEdit.transition === "cut" ? 0.1 : Math.max(0.1, prevEdit.transitionDurationMs / 1000);
    const clipDur = (plan.scenes[k].timing.videoEndMs - plan.scenes[k].timing.videoStartMs) / 1000;
    const offsetSec = Math.max(0, accDurSec - transDur);
    const out = join(`fold-${k}.mp4`);
    await input.runFfmpeg(
      buildXfadeArgv({
        aPath: acc,
        bPath: normPaths[k],
        transition: prevEdit.transition,
        transitionDurationMs: prevEdit.transitionDurationMs,
        offsetSec,
        fps,
        outputPath: out,
      }),
      `xfade-${k}`,
    );
    acc = out;
    accDurSec = accDurSec + clipDur - transDur;
    tick();
  }

  // ── Pass 3: finalize (captions + audio) ───────────────────────────────────
  await input.runFfmpeg(
    buildFinalizeArgv({
      silentVideoPath: acc,
      assPath: input.assPath,
      narrationInputPath: input.narrationInputPath,
      musicInputPath: input.musicInputPath,
      musicDuckingDb: plan.audio.musicDuckingDb,
      width: W, height: H, fps,
      durationSec: plan.output.durationMs / 1000,
      outputPath: input.outputPath,
    }),
    "finalize",
  );
  tick();
}
