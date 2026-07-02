/**
 * Sprint 45 (Audio Timing + Music Mix) — local, deterministic validation.
 *
 * Exercises the EXACT shipped code path — composeMultiPass with
 * narrationSegmentPaths (scene-timed voice) + musicInputPath (looped, faded,
 * side-chain-ducked bed) — using synthetic sources:
 *
 *   scenes: 3 × 3s test patterns
 *   voice:  3 × 1s sine tones (440/660/880 Hz) — one per scene
 *   music:  4s 220 Hz sine (shorter than the 9s video → must LOOP)
 *
 * Assertions (ffmpeg volumedetect per window):
 *   A. voice windows (scene starts) are LOUD (tone + music)
 *   B. gap windows (after each voice line) still have MUSIC (not silence) —
 *      this was the old defect: audio ended with the narration
 *   C. the final second is quieter than mid-video (fade-out engaged)
 *   D. overall max volume ≤ 0 dB (limiter → no clipping)
 *   E. audio stream duration ≈ video duration (9s)
 *
 *   npx tsx scripts/validate-audio-timing.ts
 */
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { composeMultiPass } from "@/lib/ffmpeg-pipeline/ffmpeg";
import type { CompositionPlan, TimedCaption } from "@/lib/ffmpeg-pipeline/types";

const OUT = path.resolve("scripts/_audio_timing_out");
const W = 540, H = 960, FPS = 30, SCENE_MS = 3000, N = 3;

function run(argv: string[], label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", argv, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("close", (code) =>
      code === 0 ? resolve(err) : reject(new Error(`${label} exit ${code}: ${err.slice(-1200)}`)),
    );
  });
}

function probeAudioDuration(file: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v", "error", "-select_streams", "a:0",
      "-show_entries", "stream=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", file,
    ], { windowsHide: true });
    let out = "";
    p.stdout.on("data", (c) => (out += c.toString()));
    p.on("close", () => resolve(Number(out.trim()) || 0));
  });
}

async function windowVolume(file: string, startSec: number, durSec: number): Promise<{ mean: number; max: number }> {
  const stderr = await run(
    ["-ss", String(startSec), "-t", String(durSec), "-i", file, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"],
    `volumedetect ${startSec}-${startSec + durSec}`,
  );
  const mean = Number(/mean_volume:\s*(-?[\d.]+)/.exec(stderr)?.[1] ?? NaN);
  const max = Number(/max_volume:\s*(-?[\d.]+)/.exec(stderr)?.[1] ?? NaN);
  return { mean, max };
}

const captions: TimedCaption[] = Array.from({ length: N }, (_, k) => ({
  sceneId: k + 1,
  text: `Scene ${k + 1} caption`,
  startMs: k * SCENE_MS + 100,
  endMs: (k + 1) * SCENE_MS - 100,
  lineBreaks: [`Scene ${k + 1} caption`],
}));

function makePlan(): CompositionPlan {
  const scenes = Array.from({ length: N }, (_, k) => ({
    plan: { sceneId: k + 1 } as never,
    clip: {} as never,
    caption: captions[k],
    timing: {
      sceneId: k + 1, videoStartMs: k * SCENE_MS, videoEndMs: (k + 1) * SCENE_MS,
      transitionInMs: 0, transitionOutMs: 0, kenBurnsMs: SCENE_MS,
    },
    edit: {
      sceneId: k + 1, zoom: { from: 1, to: 1 }, pan: { fromX: 0, fromY: 0, toX: 0, toY: 0 },
      transition: "cut" as const, transitionDurationMs: 0, grade: "natural" as const,
    },
  }));
  return {
    version: "ffmpeg-v2", renderJobId: "local-audio-timing", userId: "local", topic: "audio-timing",
    scenes,
    audio: { narrationUrl: "", musicUrl: "", musicDuckingDb: -12 },
    output: { width: W, height: H, fps: FPS, durationMs: N * SCENE_MS },
    globalGrade: "natural",
    artifacts: {} as never,
  } as unknown as CompositionPlan;
}

async function main(): Promise<void> {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // Synthetic sources
  const scenePaths: string[] = [];
  for (let k = 0; k < N; k++) {
    const out = path.join(OUT, `scene-${k}.mp4`);
    await run(
      ["-y", "-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS}:duration=${SCENE_MS / 1000}`,
       "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", out],
      `scene-${k}`,
    );
    scenePaths.push(out);
  }
  const segPaths: { sceneId: number; path: string }[] = [];
  const freqs = [440, 660, 880];
  for (let k = 0; k < N; k++) {
    const out = path.join(OUT, `voice-${k + 1}.mp3`);
    await run(
      ["-y", "-f", "lavfi", "-i", `sine=frequency=${freqs[k]}:duration=1`, "-c:a", "libmp3lame", out],
      `voice-${k + 1}`,
    );
    segPaths.push({ sceneId: k + 1, path: out });
  }
  const musicPath = path.join(OUT, "music.mp3");
  // 4s < 9s video → proves looping. -18dB source so ducking math is visible.
  await run(
    ["-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=4", "-af", "volume=0.5", "-c:a", "libmp3lame", musicPath],
    "music",
  );

  // Shipped code path
  const workDir = path.join(OUT, "work");
  await mkdir(workDir, { recursive: true });
  const outputPath = path.join(OUT, "final.mp4");
  await composeMultiPass({
    plan: makePlan(),
    sceneInputPaths: scenePaths,
    narrationInputPath: null,
    narrationSegmentPaths: segPaths,
    musicInputPath: musicPath,
    assPath: path.join(workDir, "captions.ass"),
    workDir,
    outputPath,
    runFfmpeg: async (argv, label) => { await run(argv, label); },
  });

  // ── Assertions ────────────────────────────────────────────────────────────
  const audioDur = await probeAudioDuration(outputPath);
  const voice1 = await windowVolume(outputPath, 0.1, 0.8);   // scene 1 line
  const gap1 = await windowVolume(outputPath, 1.6, 1.2);     // after line 1 → music must persist
  const voice2 = await windowVolume(outputPath, 3.1, 0.8);   // scene 2 line at ~3.0s
  const gap2 = await windowVolume(outputPath, 4.6, 1.2);
  const voice3 = await windowVolume(outputPath, 6.1, 0.8);   // scene 3 line at ~6.0s
  const mid = await windowVolume(outputPath, 5.0, 1.0);
  const tail = await windowVolume(outputPath, 8.3, 0.6);     // fade-out region
  const overall = await windowVolume(outputPath, 0, 9);

  const results: { name: string; ok: boolean; detail: string }[] = [
    { name: "E audio spans video", ok: audioDur > 8.5, detail: `audio stream ${audioDur.toFixed(2)}s (video 9s)` },
    { name: "A1 voice @ scene1", ok: voice1.mean > -25, detail: `mean ${voice1.mean} dB` },
    { name: "A2 voice @ scene2 start", ok: voice2.mean > -25, detail: `mean ${voice2.mean} dB` },
    { name: "A3 voice @ scene3 start", ok: voice3.mean > -25, detail: `mean ${voice3.mean} dB` },
    { name: "B1 music persists after line1 (old bug = silence)", ok: gap1.mean > -55, detail: `mean ${gap1.mean} dB` },
    { name: "B2 music persists after line2", ok: gap2.mean > -55, detail: `mean ${gap2.mean} dB` },
    { name: "B3 gaps quieter than voice (ducking sane)", ok: gap1.mean < voice1.mean && gap2.mean < voice2.mean, detail: `gap1 ${gap1.mean} < v1 ${voice1.mean}; gap2 ${gap2.mean} < v2 ${voice2.mean}` },
    { name: "C fade-out engaged", ok: tail.mean < mid.mean - 3, detail: `tail ${tail.mean} dB vs mid ${mid.mean} dB` },
    { name: "D no clipping", ok: overall.max <= 0.1, detail: `max ${overall.max} dB` },
  ];
  let failed = 0;
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name} — ${r.detail}`);
    if (!r.ok) failed++;
  }
  // eslint-disable-next-line no-console
  console.log(failed === 0 ? "\nALL AUDIO-TIMING CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
