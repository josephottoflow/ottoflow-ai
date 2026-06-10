/**
 * Agent 11: FFmpeg Composition.
 *
 * Inputs:
 *   - CompositionPlan (Agents 1-10 frozen output, from BullMQ payload)
 *   - workDir (a /tmp directory the worker pre-creates)
 *
 * Steps:
 *   1. Download every scene's selected clip to {workDir}/scene-{i}.mp4
 *      Parallel, with bounded concurrency.
 *   2. Download narration (data URL or http URL → narration.mp3)
 *   3. Download music if present → music.mp3
 *   4. Render captions ASS file → captions.ass
 *   5. Build the ffmpeg argv via ffmpeg.ts buildFfmpegArgv()
 *   6. Spawn ffmpeg, capture FULL stderr, return CompositionResult
 *
 * No Supabase calls in here — the worker processor handles upload + DB
 * writes. This file is single-responsibility: "run ffmpeg".
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { renderAss } from "../ass-captions";
import { composeMultiPass } from "../ffmpeg";
import type {
  AgentContext,
  CompositionPlan,
  CompositionResult,
  FfmpegComposerInput,
} from "../types";

// ─── Helpers ───────────────────────────────────────────────────────────────

async function downloadTo(url: string, dest: string): Promise<void> {
  if (url.startsWith("data:")) {
    const m = url.match(/^data:[^;]+;base64,(.+)$/);
    if (!m) throw new Error(`composer: invalid data URL`);
    await fs.writeFile(dest, Buffer.from(m[1], "base64"));
    return;
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`composer: download failed ${url}: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
}

async function downloadAllScenes(
  plan: CompositionPlan,
  workDir: string,
  ctx: AgentContext,
): Promise<string[]> {
  const CONCURRENCY = 4;
  const paths: string[] = new Array(plan.scenes.length);
  let cursor = 0;
  const fail: { idx: number; error: string }[] = [];

  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= plan.scenes.length) return;
      const scene = plan.scenes[i];
      const dest = path.join(workDir, `scene-${scene.plan.sceneId}.mp4`);
      try {
        await downloadTo(scene.clip.url, dest);
        paths[i] = dest;
      } catch (err) {
        fail.push({
          idx: i,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, plan.scenes.length) }, () => worker()),
  );

  if (fail.length > 0) {
    ctx.log("agent.ffmpegComposer.scene_download_failed", { fail });
    throw new Error(
      `composer: ${fail.length} of ${plan.scenes.length} scene downloads failed: ${fail.map((f) => `[${f.idx}] ${f.error}`).join("; ")}`,
    );
  }
  return paths;
}

function runFfmpeg(argv: string[]): Promise<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", argv, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code, signal) => resolve({ exitCode: code, signal, stderr }));
  });
}

// ─── Public entry ──────────────────────────────────────────────────────────

export async function runFfmpegComposer(
  input: FfmpegComposerInput,
  ctx: AgentContext,
): Promise<CompositionResult> {
  const { plan, workDir } = input;
  ctx.log("agent.ffmpegComposer.start", {
    sceneCount: plan.scenes.length,
    durationMs: plan.output.durationMs,
  });

  await fs.mkdir(workDir, { recursive: true });

  // 1. Download scenes
  const scenePaths = await downloadAllScenes(plan, workDir, ctx);
  ctx.log("agent.ffmpegComposer.scenes_downloaded");

  // 2. Narration
  const narrationPath = path.join(workDir, "narration.mp3");
  if (!plan.audio.narrationUrl) {
    throw new Error("composer: narrationUrl is empty — orchestrator must populate before enqueue");
  }
  await downloadTo(plan.audio.narrationUrl, narrationPath);

  // 3. Music (optional)
  let musicPath: string | null = null;
  if (plan.audio.musicUrl) {
    musicPath = path.join(workDir, "music.mp3");
    try {
      await downloadTo(plan.audio.musicUrl, musicPath);
    } catch (err) {
      // Music is optional — log + continue silent.
      ctx.log("agent.ffmpegComposer.music_download_failed", {
        reason: err instanceof Error ? err.message : String(err),
      });
      musicPath = null;
    }
  }

  // 4. Captions ASS
  const assPath = path.join(workDir, "captions.ass");
  const assContent = renderAss(plan.scenes.map((s) => s.caption));
  await fs.writeFile(assPath, assContent, "utf-8");

  // 5-6. Low-memory multi-pass compose (normalize → pairwise xfade → finalize).
  // Each ffmpeg invocation keeps ≤2 concurrent 1080x1920 decodes so peak RSS
  // stays under the 1 GB worker cap. A single all-scenes filtergraph OOM'd.
  const outputPath = path.join(workDir, "out.mp4");
  let lastStderr = "";
  const runOne = async (argv: string[], label: string): Promise<void> => {
    ctx.log("agent.ffmpegComposer.pass", { label, argvLength: argv.length });
    const { exitCode, signal, stderr } = await runFfmpeg(argv);
    lastStderr = stderr;
    if (exitCode !== 0 || signal !== null) {
      throw new Error(
        `ffmpeg pass "${label}" failed (code=${exitCode}, signal=${signal}): ${stderr.slice(-2500)}`,
      );
    }
  };

  await composeMultiPass({
    plan,
    sceneInputPaths: scenePaths,
    narrationInputPath: narrationPath,
    musicInputPath: musicPath,
    assPath,
    workDir,
    outputPath,
    runFfmpeg: runOne,
  });

  // 7. Probe output for the result struct. Plan dictates dimensions; we just
  //    confirm the file exists + report size.
  const stat = await fs.stat(outputPath);
  ctx.log("agent.ffmpegComposer.done", {
    bytes: stat.size,
    durationMs: plan.output.durationMs,
  });

  return {
    localPath: outputPath,
    durationSec: plan.output.durationMs / 1000,
    width: plan.output.width,
    height: plan.output.height,
    ffmpegStderr: lastStderr,
  };
}
