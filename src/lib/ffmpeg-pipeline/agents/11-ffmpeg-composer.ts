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
import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { renderAss } from "../ass-captions";
import { composeMultiPass } from "../ffmpeg";
import { renderCtaCard, fetchLogoBytes } from "../branding";
import { createAdminClient } from "@/lib/supabase";
import type {
  AgentContext,
  CompositionPlan,
  CompositionResult,
  FfmpegComposerInput,
} from "../types";

/** CTA end card duration (seconds) for the Video V1 branding layer. */
const CTA_CARD_SEC = 3;

// ─── Helpers ───────────────────────────────────────────────────────────────

async function downloadTo(url: string, dest: string): Promise<void> {
  if (url.startsWith("data:")) {
    const m = url.match(/^data:[^;]+;base64,(.+)$/);
    if (!m) throw new Error(`composer: invalid data URL`);
    await fs.writeFile(dest, Buffer.from(m[1], "base64"));
    return;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`composer: download failed ${url}: ${res.status} ${res.statusText}`);
  }
  // STREAM to disk — do NOT buffer the whole clip in memory. Buffering all
  // scene clips (arrayBuffer) at CONCURRENCY 4 held ~4 full clips in Node RSS
  // during the first ffmpeg pass and contributed to the 1 GB worker OOM.
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(dest));
}

async function downloadAllScenes(
  plan: CompositionPlan,
  workDir: string,
  ctx: AgentContext,
): Promise<string[]> {
  // Low concurrency: each in-flight download + its disk write adds memory
  // pressure on the 1 GB worker. 2 is a safe balance of speed vs RSS.
  const CONCURRENCY = 2;
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

  // 2. Narration (OPTIONAL — AI-first scenes-only videos may be silent/music-only)
  let narrationPath: string | null = null;
  if (plan.audio.narrationUrl) {
    narrationPath = path.join(workDir, "narration.mp3");
    await downloadTo(plan.audio.narrationUrl, narrationPath);
  }

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

  // 4. Captions ASS — brand typography from the Visual World (absent → proven
  // default header, byte-identical to pre-V1).
  const assPath = path.join(workDir, "captions.ass");
  const t = plan.branding?.typography;
  const assContent = renderAss(
    plan.scenes.map((s) => s.caption),
    t
      ? { font: t.captionFont, sizePct: t.captionSizePct, color: t.color, boxOpacity: t.boxOpacity, case: t.case }
      : undefined,
  );
  await fs.writeFile(assPath, assContent, "utf-8");

  // 4b. Deterministic branding (Video V1) — logo overlay + CTA end card.
  // Brand asset bytes are written to disk and composited by FFmpeg; they are
  // NEVER sent to a model. Absent on the stock pipeline (plan.branding unset)
  // → no logo, no CTA card, behaviour unchanged.
  let logoPath: string | null = null;
  let ctaCard: { pngPath: string; durationSec: number } | null = null;
  if (plan.branding) {
    const admin = createAdminClient();
    let logoBytes: Buffer | null = null;
    if (plan.branding.logoAssetId) {
      logoBytes = await fetchLogoBytes(admin, plan.branding.logoAssetId);
      if (logoBytes) {
        logoPath = path.join(workDir, "logo.png");
        await fs.writeFile(logoPath, logoBytes);
      }
    }
    if (plan.branding.ctaText) {
      const cardPng = await renderCtaCard({
        width: plan.output.width,
        height: plan.output.height,
        ctaText: plan.branding.ctaText,
        brandName: plan.branding.brandName ?? null,
        palette: plan.branding.palette ?? null,
        // Logo intentionally OMITTED. buildFinalizeArgv overlays the logo
        // bottom-right across the ENTIRE timeline (incl. this end card), so
        // compositing it into the card too produced the duplicate-logo defect
        // on cert 2594ea2e (top-center card logo + bottom-right overlay).
        logo: null,
      });
      const cardPath = path.join(workDir, "cta-card.png");
      await fs.writeFile(cardPath, cardPng);
      ctaCard = { pngPath: cardPath, durationSec: CTA_CARD_SEC };
    }
  }

  // 5-6. Low-memory multi-pass compose (normalize → concat → finalize).
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
    logoPath,
    ctaCard,
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
