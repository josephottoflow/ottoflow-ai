/**
 * Video Merge processor.
 *
 * Combines the Pexels stock clip + ElevenLabs narration MP3 + Jamendo music
 * MP3 into a single MP4 with audio baked in, then uploads the result to the
 * Supabase Storage `merged-videos` bucket and writes the public URL back to
 * the render_jobs row.
 *
 * The Video Pipeline (/api/generate) emits 3 separate playable assets so the
 * SSE flow can show progress incrementally. This worker takes those URLs +
 * the data URL for narration and produces ONE downloadable file the user can
 * post to TikTok/IG/etc.
 *
 * FFmpeg filter graph:
 *   - Video stream: passthrough, original audio stripped
 *   - Narration:    full volume
 *   - Music:        ducked (-12 dB by default, configurable), looped if shorter
 *                   than narration
 *   - Mix:          amix=duration=longest, weighted toward narration
 *   - Final:        -shortest so the output trims to the actual video duration
 *
 * If narration is missing → music plays solo (looped to video length).
 * If music is missing → narration over silent video.
 * If both missing → video keeps its original audio (best-effort fallback).
 *
 * Failure modes:
 *   - Download fails → status=failed, error logged, retried via BullMQ
 *   - FFmpeg returns non-zero → captured + surfaced via merge_error
 *   - Storage upload fails → same
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase";
import type { VideoMergeJobData, VideoMergeOverlay, VideoMergeScene } from "@/lib/queue";
import { generateScene as registryGenerateScene } from "@/lib/video-providers/registry";
import { recordAIUsage } from "@/lib/budget";
import { captureFallback } from "@/lib/observability";

type Reporter = (step: string, progress: number) => void;

// ─── Font resolution (Phase 4 overlays) ─────────────────────────────────────
// We use `fc-match` to find a real on-disk TTF path so drawtext's `fontfile`
// param resolves cleanly. Cached at module level — first call probes, every
// subsequent call returns the cached path. If everything fails the overlay
// chain falls back to drawtext WITHOUT fontfile (ffmpeg picks a default).
let cachedFontPath: string | null | undefined;

async function resolveFontPath(): Promise<string | null> {
  if (cachedFontPath !== undefined) return cachedFontPath;
  const override = process.env.OVERLAY_FONT_PATH;
  if (override) {
    try {
      await fs.access(override);
      cachedFontPath = override;
      return cachedFontPath;
    } catch {
      // fall through to fc-match
    }
  }
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn("fc-match", [
        "-f",
        "%{file}",
        "DejaVu Sans:style=Bold",
      ]);
      let out = "";
      let err = "";
      proc.stdout.on("data", (c) => (out += c.toString()));
      proc.stderr.on("data", (c) => (err += c.toString()));
      proc.on("error", reject);
      proc.on("close", (code) =>
        code === 0 && out.trim()
          ? resolve(out.trim())
          : reject(new Error(`fc-match failed (${code}): ${err}`)),
      );
    });
    cachedFontPath = result;
    return cachedFontPath;
  } catch {
    cachedFontPath = null;
    return null;
  }
}

interface FfmpegResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

/**
 * Run ffmpeg, capture stderr (where ffmpeg writes its progress + errors)
 * AND the kill signal if the process was terminated. Exit code = null and
 * signal != null means "killed by OS/Railway" (usually OOM or build-time
 * resource cap).
 */
async function runFfmpeg(args: string[]): Promise<FfmpegResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    // Keep the FULL stderr — ffmpeg's progress reports push the real error
    // line out of any short trailing window, leaving the operator staring
    // at "bitrate 0/0/0 buffer" instead of the actual cause.
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code, signal) =>
      resolve({ exitCode: code, signal, stderr }),
    );
  });
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download ${url} failed: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
}

/** Decode a data:audio/mpeg;base64,... URL to disk. */
async function writeDataUrlToFile(dataUrl: string, dest: string): Promise<void> {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("Invalid audio data URL");
  await fs.writeFile(dest, Buffer.from(m[2], "base64"));
}

// ─── Phase 4 — drawtext keyword overlay chain ────────────────────────────────
//
// Each overlay becomes one drawtext filter in a chained filter graph. We
// use FFmpeg expressions for fontsize + alpha so the text "scale pops" from
// 1.2x → 1.0x in the first 150ms and fades out over the last 150ms. Only
// renders during [start, end] — outside that window alpha=0 hides the
// drawtext output entirely.
//
// Why two FFmpeg expressions (fontsize + alpha) instead of a wrapping
// filter like `scale`/`zoompan`: drawtext supports per-frame expressions
// natively, which is exactly the per-text-box animation we want. zoompan
// would re-encode the entire frame for ONE overlay — orders of magnitude
// slower.
//
// Video Pipeline v2 P3 — position rotates per scene so the video reads
// as edited rather than every overlay stamping at the same lower-third.
// When `sceneIndex` is set on the overlay (P2 wired it from /api/generate),
// the y-coordinate is picked deterministically from OVERLAY_Y_POSITIONS by
// (sceneIndex - 1) mod 5. Overlays without sceneIndex fall back to the
// legacy lower-third for backward compat.

const OVERLAY_Y_POSITIONS = [
  "h*0.18",       // top-third
  "(h-text_h)/2", // true vertical center
  "h*0.65",       // lower-third (legacy default)
  "h*0.78",       // very low (above TikTok UI overlay zone)
  "h*0.40",       // upper-middle
] as const;

function pickYForScene(sceneIndex: number | undefined | null): string {
  if (sceneIndex == null || sceneIndex < 1) return "h*0.65";
  return OVERLAY_Y_POSITIONS[(sceneIndex - 1) % OVERLAY_Y_POSITIONS.length];
}

function buildDrawtextChain(
  overlays: VideoMergeOverlay[],
  fontPath: string | null,
  videoHeightHint: number,
): string {
  // Cap baseSize to a tasteful range so very tall (4K) sources don't get
  // 600px text. videoHeightHint of 0 (unknown) defaults to 1080.
  const target = videoHeightHint > 0 ? videoHeightHint : 1080;
  const baseSize = Math.min(120, Math.max(56, Math.round(target * 0.085)));

  return overlays
    .map((o) => {
      const s = o.start.toFixed(3);
      const e = o.end.toFixed(3);
      // FFmpeg text-arg escaping: drawtext expects a single-quoted string;
      // any apostrophe inside the text closes the string. We escape via
      // \' which drawtext understands. Also strip newlines so a stray \n
      // doesn't break the filter.
      const escapedText = o.text
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/[\r\n]/g, " ");
      // Scale pop: fontsize starts at 1.2x for the first 150ms, settles at
      // 1.0x for the rest of the visible window. Hidden outside [s, e]
      // (fontsize=0 wouldn't actually hide the box — we use alpha=0 below
      // for that).
      const fontsizeExpr = `if(between(t,${s},${e}),if(lt(t,${s}+0.15),${baseSize}*(1.2-0.2*(t-${s})/0.15),${baseSize}),${baseSize})`;
      // Alpha envelope: fade in 150ms, hold, fade out 150ms.
      const alphaExpr = `if(between(t,${s},${e}),if(lt(t,${s}+0.15),(t-${s})/0.15,if(lt(t,${e}-0.15),1,(${e}-t)/0.15)),0)`;
      const fontFilePart = fontPath
        ? `:fontfile='${fontPath.replace(/'/g, "\\'")}'`
        : "";
      // P3 — per-scene y-position rotation. Falls back to legacy h*0.65
      // when the overlay carries no sceneIndex (free-form prompt path).
      const y = pickYForScene(o.sceneIndex);
      return (
        `drawtext=text='${escapedText}'` +
        fontFilePart +
        `:fontcolor=white` +
        `:borderw=4:bordercolor=black` +
        `:shadowx=4:shadowy=6:shadowcolor=black@0.6` +
        `:x=(w-text_w)/2:y=${y}` +
        `:fontsize='${fontsizeExpr}'` +
        `:alpha='${alphaExpr}'`
      );
    })
    .join(",");
}

export async function processVideoMerge(
  data: VideoMergeJobData,
  report: Reporter,
): Promise<{ ok: true; mergedUrl: string }> {
  const admin = createAdminClient();
  const { renderJobId, userId, videoUrl, audioDataUrl, musicUrl, overlays, sceneSpecs, aestheticNotes, brandIndustry, topicTitle } = data;
  let { scenes } = data;
  const duckingDb = data.musicDuckingDb ?? -12;
  const hasOverlays = !!overlays && overlays.length > 0;
  const needsSceneGeneration = !!sceneSpecs && sceneSpecs.length > 1 && (!scenes || scenes.length === 0);
  // Phase 1A (VIDEO_VARIATION_AUDIT §P1.4) — storyboard aestheticNotes prefix
  // for every scene prompt. Cap at 400 chars to keep provider prompts focused
  // and prevent runaway aesthetic instructions from drowning out the scene's
  // own visual brief.
  const aestheticPrefix = aestheticNotes
    ? aestheticNotes.slice(0, 400).trim() + " "
    : "";

  // ─── Phase D · Worker-side scene generation ─────────────────────────────────
  // When the route handed us specs (storyboard scenes that haven't been
  // turned into clips yet), we run the provider chain HERE in the worker
  // instead of in the SSE handler. This eliminates the 300s Vercel
  // function timeout exposure that put C1 in the audit report.
  //
  // Concurrency cap of 3 keeps us under Runway/Luma rate limits. Each
  // scene's row gets inserted as it completes so the /video/[jobId]
  // detail page can show live progress via Realtime.
  //
  // Video Pipeline v2 F1 — track per-scene failure reasons so we can write
  // a single structured merge_error explaining WHY a 4-scene plan ended up
  // a 1-clip video. The audit (VIDEO_TIMELINE_AUDIT.md) showed this is
  // the dominant failure mode in production.
  const sceneFailures: { index: number; reason: string }[] = [];
  if (needsSceneGeneration) {
    report("merging", 5);
    const completed: VideoMergeScene[] = [];
    const CONCURRENCY = 3;
    const specs = [...sceneSpecs!].sort((a, b) => a.index - b.index);
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= specs.length) return;
        const spec = specs[i];
        const startedAt = Date.now();
        let row: Record<string, unknown>;
        try {
          const result = await registryGenerateScene({
            // Phase 1A — prepend aestheticNotes so Runway/Luma carry the
            // storyboard's palette + lighting + pacing direction. Falls
            // back to the raw scene prompt when no aesthetic was generated.
            prompt: `${aestheticPrefix}${spec.prompt}`.trim(),
            durationSec: spec.durationSec,
            aspectRatio: "9:16",
            // v2 F3 — brand/topic context for per-scene Pexels fallback
            // + Runway seed-photo search. brandIndustry/topicTitle come
            // from the merge JobData (shared across scenes); shotType
            // comes from this scene's spec.
            brandIndustry: brandIndustry ?? null,
            topicTitle: topicTitle ?? null,
            shotType: spec.shotType ?? null,
          });
          const generationTimeMs = Date.now() - startedAt;
          completed.push({
            index: spec.index,
            url: result.url,
            durationSec: result.durationSec,
            provider: result.provider,
          });
          row = {
            render_job_id: renderJobId,
            scene_number: spec.index,
            prompt: spec.prompt,
            shot_type: spec.shotType,
            provider: result.provider,
            clip_url: result.url,
            duration_sec: result.durationSec,
            width: result.width,
            height: result.height,
            generation_time_ms: generationTimeMs,
            cost_usd: result.costUsd ?? null,
            fallback_reason: null,
            attribution: result.attribution ?? null,
            metadata: result.metadata ?? null,
          };
          // R1: write a ledger entry when the provider actually charged.
          // Pexels (free) returns costUsd=0; recordAIUsage skips those.
          if ((result.costUsd ?? 0) > 0) {
            void recordAIUsage({
              userId,
              renderJobId,
              provider: result.provider as "runway" | "luma",
              operation: "generateScene",
              costUsd: result.costUsd ?? 0,
              units: result.durationSec,
              unitType: "seconds",
              metadata: {
                scene_number: spec.index,
                width: result.width,
                height: result.height,
              },
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // v2 F1 — collect per-scene failures so we can surface a single
          // structured merge_error explaining why the user sees one clip.
          sceneFailures.push({ index: spec.index, reason: message.slice(0, 200) });
          row = {
            render_job_id: renderJobId,
            scene_number: spec.index,
            prompt: spec.prompt,
            shot_type: spec.shotType,
            provider: "failed",
            clip_url: null,
            duration_sec: null,
            width: null,
            height: null,
            generation_time_ms: Date.now() - startedAt,
            cost_usd: null,
            fallback_reason: message.slice(0, 500),
            attribution: null,
            metadata: null,
          };
        }
        // Per-scene insert so Realtime fires incrementally rather than
        // landing all rows at once at the end.
        await admin.from("scene_generations").insert(row);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, specs.length) }, () => worker()),
    );
    completed.sort((a, b) => a.index - b.index);

    // ─── Video Pipeline v2 F4 — pad partial success ──────────────────────
    // The old policy: scenes = completed. If only 1 of 4 scenes succeeded
    // the worker would throw the partial result away and fall back to a
    // single-clip Pexels prefetch. F4 keeps the successful scenes and
    // fills the missing slots with the prefetched `videoUrl` so the user
    // sees what their plan produced instead of a uniform stock clip.
    //
    // Each gap is filled at the spec's original durationSec (the ffmpeg
    // normalize step caps each input via `-t targetDur`). All gaps share
    // the same videoUrl source — visually they'll look identical, but
    // the AI-generated successful scenes still get to shine through.
    const successByIndex = new Map(completed.map((c) => [c.index, c]));
    const padded: VideoMergeScene[] = [];
    for (const spec of specs) {
      const hit = successByIndex.get(spec.index);
      if (hit) {
        padded.push(hit);
      } else if (videoUrl && videoUrl.length > 0) {
        padded.push({
          index: spec.index,
          url: videoUrl,
          durationSec: spec.durationSec,
          provider: "pexels-fallback",
        });
      }
      // If no videoUrl prefetch is available either, we drop the slot — the
      // remaining concat will still produce a multi-segment video from the
      // successful ones.
    }
    scenes = padded;
  }

  // ─── F4: hasScenes threshold relaxed from > 1 to >= 1 ──────────────────
  // Together with the padding above, this means: any planned multi-scene
  // job with at least one slot resolved (either a real scene gen or a
  // padded prefetch) goes through the concat path. The single-clip path
  // is now reserved for truly single-clip jobs (sceneSpecs absent or
  // length ≤ 1 from the route).
  const hasScenes = !!scenes && scenes.length >= 1;

  // ─── F1 — surface silent fallback ──────────────────────────────────────
  // If the route asked for multi-scene but every single provider call
  // failed, write a structured merge_error to the render_jobs row so the
  // UI can show it AND Sentry gets paged. The user sees one stock clip;
  // we want them (and us) to know why.
  if (needsSceneGeneration && sceneFailures.length === sceneSpecs!.length) {
    const failureMsg = `Scene generation produced 0 of ${sceneSpecs!.length} clips — reverted to single Pexels clip. First failure: ${sceneFailures[0]?.reason ?? "unknown"}`;
    await admin
      .from("render_jobs")
      .update({ merge_error: failureMsg })
      .eq("id", renderJobId);
    captureFallback("video-merge.all_scenes_failed", new Error(failureMsg), {
      renderJobId,
      sceneCount: sceneSpecs!.length,
      failures: sceneFailures.slice(0, 5),
    });
  } else if (needsSceneGeneration && sceneFailures.length > 0) {
    // Partial failure — log but don't write merge_error (the merge will
    // still produce a multi-segment video thanks to F4 padding).
    captureFallback(
      "video-merge.partial_scene_failure",
      new Error(`${sceneFailures.length} of ${sceneSpecs!.length} scenes failed`),
      {
        renderJobId,
        sceneCount: sceneSpecs!.length,
        failedCount: sceneFailures.length,
        failures: sceneFailures.slice(0, 5),
      },
    );
  }

  // Working directory under /tmp — Railway gives ample disk for this.
  const workDir = path.join(tmpdir(), `merge-${renderJobId}-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });

  const videoIn = path.join(workDir, "video.mp4");
  const narrationIn = path.join(workDir, "narration.mp3");
  const musicIn = path.join(workDir, "music.mp3");
  const out = path.join(workDir, "merged.mp4");

  // Mark merging
  await admin
    .from("render_jobs")
    .update({ merge_status: "merging" })
    .eq("id", renderJobId);
  report("merging", 10);

  try {
    // ─── 1. Download all inputs in parallel ────────────────────────────────
    //
    // When `scenes` is provided (≥2 entries), we ignore the legacy
    // `videoUrl` and download each scene clip in parallel. A subsequent
    // ffmpeg concat step (Path C below) stitches them into `videoIn` for
    // the rest of the pipeline. Single-clip path stays unchanged.
    const tasks: Promise<unknown>[] = [];
    const sceneFiles: string[] = [];
    if (hasScenes) {
      const ordered = [...scenes!].sort((a, b) => a.index - b.index);
      ordered.forEach((s, i) => {
        const localPath = path.join(workDir, `scene-${String(i).padStart(3, "0")}.mp4`);
        sceneFiles.push(localPath);
        tasks.push(downloadToFile(s.url, localPath));
      });
    } else {
      tasks.push(downloadToFile(videoUrl, videoIn));
    }

    let hasNarration = false;
    let hasMusic = false;
    if (audioDataUrl) {
      tasks.push(writeDataUrlToFile(audioDataUrl, narrationIn));
      hasNarration = true;
    }
    if (musicUrl) {
      tasks.push(downloadToFile(musicUrl, musicIn));
      hasMusic = true;
    }
    await Promise.all(tasks);
    report("merging", 28);

    // ─── 1b. Multi-scene concat into a single videoIn ─────────────────────
    // Run BEFORE the audio merge so the audio + overlay logic below stays
    // identical to the single-clip path. We normalize each scene to
    // 1080x1920 @ 30fps so the concat demuxer doesn't reject mismatched
    // streams (Runway returns 720p, Luma returns 720p, Pexels varies).
    if (hasScenes) {
      // Step 1b.1 — re-encode each scene to a normalized intermediate.
      const normalizedFiles: string[] = [];
      for (let i = 0; i < sceneFiles.length; i++) {
        const src = sceneFiles[i];
        const dest = path.join(workDir, `norm-${String(i).padStart(3, "0")}.mp4`);
        normalizedFiles.push(dest);
        const targetDur = scenes![i].durationSec;
        const norm = await runFfmpeg([
          "-y",
          "-i", src,
          // Scale + pad to 720x1280 preserving aspect ratio. Drops from
          // 1080x1920 to match the source resolution (Pexels portrait HD
          // is 720x1280, Luma 720p, Runway 720x1280) which means we avoid
          // a full-resolution-doubling re-encode that was OOM-killing
          // libx264 on Railway. setsar=1 prevents concat SAR mismatch.
          "-vf",
          "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30",
          // Cap at scene's target duration so a long source clip doesn't
          // bleed into the next scene's window.
          "-t", String(targetDur),
          "-an",                  // strip audio from individual scenes
          "-c:v", "libx264",
          // Ultrafast preset + mbtree disabled minimizes libx264 memory
          // footprint. We trade ~10% size for getting under Railway's
          // worker RAM cap.
          "-preset", "ultrafast",
          "-x264-params", "no-mbtree=1:rc-lookahead=10",
          "-crf", "26",
          "-pix_fmt", "yuv420p",
          dest,
        ]);
        if (norm.exitCode !== 0 || norm.signal !== null) {
          throw new Error(
            `Scene ${i + 1} normalize failed (code=${norm.exitCode}, signal=${norm.signal}): ${norm.stderr.slice(-1000)}`,
          );
        }
      }

      // Step 1b.2 — concat demuxer requires a manifest file.
      const concatManifest = path.join(workDir, "concat.txt");
      await fs.writeFile(
        concatManifest,
        normalizedFiles
          .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
          .join("\n"),
        "utf-8",
      );
      // Stream-copy the concat into videoIn — all inputs share the same
      // codec/SAR/fps so concat is fast.
      const cat = await runFfmpeg([
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concatManifest,
        "-c", "copy",
        videoIn,
      ]);
      if (cat.exitCode !== 0 || cat.signal !== null) {
        throw new Error(
          `Scene concat failed (code=${cat.exitCode}, signal=${cat.signal}): ${cat.stderr.slice(-1000)}`,
        );
      }
    }
    report("merging", 35);

    // ─── 2. Build ffmpeg command ───────────────────────────────────────────
    //
    // Two-path strategy:
    //
    //   (A) NO overlays  → stream-copy video (~2-3s merge). Same fast path
    //                      that's been working in production.
    //   (B) WITH overlays → re-encode video with drawtext chain (~10-20s).
    //                      Trades speed for the visual punch users actually
    //                      want — keyword overlays are the whole product
    //                      differentiator.
    //
    // Audio handling is identical in both paths.
    let args: string[];
    const fontPath = await resolveFontPath();

    if (hasOverlays && fontPath === null) {
      // Without a font, drawtext renders with ffmpeg's default which may
      // not exist in the container. Log a warn and proceed without overlays
      // rather than crashing — the rest of the video is still usable.
      console.warn(
        "[video-merge] No font resolvable; rendering without overlays",
      );
    }

    if (!hasNarration && !hasMusic && !hasOverlays) {
      // Path A, no audio, no overlays — pure stream copy.
      args = ["-y", "-i", videoIn, "-c", "copy", out];
    } else if (!hasOverlays) {
      // Path A — preserve the previous fast paths verbatim.
      if (hasNarration && !hasMusic) {
        args = [
          "-y",
          "-i", videoIn,
          "-i", narrationIn,
          "-map", "0:v:0",
          "-map", "1:a:0",
          "-c:v", "copy",
          "-c:a", "aac",
          "-b:a", "192k",
          "-shortest",
          out,
        ];
      } else if (!hasNarration && hasMusic) {
        const musicLinearGain = Math.pow(10, duckingDb / 20);
        args = [
          "-y",
          "-i", videoIn,
          "-i", musicIn,
          "-filter_complex", `[1:a]volume=${musicLinearGain.toFixed(3)}[mus]`,
          "-map", "0:v:0",
          "-map", "[mus]",
          "-c:v", "copy",
          "-c:a", "aac",
          "-b:a", "192k",
          "-shortest",
          out,
        ];
      } else {
        // hasNarration && hasMusic
        const musicLinearGain = Math.pow(10, duckingDb / 20);
        args = [
          "-y",
          "-i", videoIn,
          "-i", narrationIn,
          "-i", musicIn,
          "-filter_complex",
          `[1:a]volume=1.0[narr];[2:a]volume=${musicLinearGain.toFixed(3)}[mus];[narr][mus]amix=inputs=2:duration=first[mix]`,
          "-map", "0:v:0",
          "-map", "[mix]",
          "-c:v", "copy",
          "-c:a", "aac",
          "-b:a", "192k",
          "-shortest",
          out,
        ];
      }
    } else {
      // Path B — drawtext chain. Re-encode the video.
      //
      // We use videoHeightHint=0 in the filter builder to fall back to
      // 1080p default — ffmpeg's `h` expression in the drawtext y= still
      // resolves at runtime against the actual frame height, so the
      // overlay sits at 65% of whatever the real video is. The hint only
      // governs base font size.
      const drawChain = buildDrawtextChain(overlays!, fontPath, 0);

      // Build audio chain depending on what's present.
      const musicLinearGain = Math.pow(10, duckingDb / 20);
      let audioFilters = "";
      let audioMapLabel: string | null = null;
      let audioInputs: string[] = [];
      if (hasNarration && !hasMusic) {
        audioInputs = ["-i", narrationIn];
        // No filter needed — map narration directly.
      } else if (!hasNarration && hasMusic) {
        audioInputs = ["-i", musicIn];
        audioFilters = `[1:a]volume=${musicLinearGain.toFixed(3)}[mus]`;
        audioMapLabel = "[mus]";
      } else if (hasNarration && hasMusic) {
        audioInputs = ["-i", narrationIn, "-i", musicIn];
        audioFilters = `[1:a]volume=1.0[narr];[2:a]volume=${musicLinearGain.toFixed(3)}[mus];[narr][mus]amix=inputs=2:duration=first[mix]`;
        audioMapLabel = "[mix]";
      }

      // Compose the filter_complex: video chain → [v_overlay]; then audio.
      const filterComplexParts: string[] = [
        `[0:v]${drawChain}[v_overlay]`,
      ];
      if (audioFilters) filterComplexParts.push(audioFilters);
      const filterComplex = filterComplexParts.join(";");

      args = [
        "-y",
        "-i", videoIn,
        ...audioInputs,
        "-filter_complex", filterComplex,
        "-map", "[v_overlay]",
      ];
      if (audioMapLabel) {
        args.push("-map", audioMapLabel);
      } else if (hasNarration) {
        args.push("-map", "1:a:0");
      }
      args.push(
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
      );
      if (hasNarration || hasMusic) {
        args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
      } else {
        args.push("-an");
      }
      args.push(out);
    }
    report("merging", 50);

    // ─── 3. Run ffmpeg ─────────────────────────────────────────────────────
    const result = await runFfmpeg(args);
    if (result.exitCode !== 0 || result.signal !== null) {
      // Surface BOTH the exit + signal AND the full stderr tail so we can
      // see the real failure (vs. trailing progress lines from libavfilter
      // that hide the actual error).
      const tail = result.stderr.slice(-2000);
      throw new Error(
        `ffmpeg failed (code=${result.exitCode}, signal=${result.signal}): ${tail}`,
      );
    }
    report("merging", 80);

    // ─── 4. Upload to Supabase Storage ─────────────────────────────────────
    const mergedBytes = await fs.readFile(out);
    const objectPath = `${userId}/${renderJobId}.mp4`;
    const { error: upErr } = await admin.storage
      .from("merged-videos")
      .upload(objectPath, mergedBytes, {
        contentType: "video/mp4",
        upsert: true,
      });
    if (upErr) {
      throw new Error(`Supabase Storage upload failed: ${upErr.message}`);
    }
    const {
      data: { publicUrl },
    } = admin.storage.from("merged-videos").getPublicUrl(objectPath);

    // ─── 5. Mark done ──────────────────────────────────────────────────────
    await admin
      .from("render_jobs")
      .update({
        merge_status: "done",
        merged_video_url: publicUrl,
        merge_error: null,
      })
      .eq("id", renderJobId);
    report("merging", 100);

    return { ok: true, mergedUrl: publicUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("render_jobs")
      .update({
        merge_status: "failed",
        merge_error: message.slice(0, 1000),
      })
      .eq("id", renderJobId);
    throw err;
  } finally {
    // Clean up /tmp; best-effort.
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
