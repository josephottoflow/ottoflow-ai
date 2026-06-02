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
import type { VideoMergeJobData } from "@/lib/queue";

type Reporter = (step: string, progress: number) => void;

interface FfmpegResult {
  exitCode: number;
  stderr: string;
}

/** Run ffmpeg, capture stderr (where ffmpeg writes its progress + errors). */
async function runFfmpeg(args: string[]): Promise<FfmpegResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) =>
      resolve({ exitCode: code ?? -1, stderr }),
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

export async function processVideoMerge(
  data: VideoMergeJobData,
  report: Reporter,
): Promise<{ ok: true; mergedUrl: string }> {
  const admin = createAdminClient();
  const { renderJobId, userId, videoUrl, audioDataUrl, musicUrl } = data;
  const duckingDb = data.musicDuckingDb ?? -12;

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
    const tasks: Promise<unknown>[] = [downloadToFile(videoUrl, videoIn)];
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
    report("merging", 35);

    // ─── 2. Build ffmpeg command ───────────────────────────────────────────
    // Note: if neither narration nor music is present we just copy the input
    // (its native audio survives) and return early.
    let args: string[];
    if (!hasNarration && !hasMusic) {
      args = [
        "-y",
        "-i", videoIn,
        "-c", "copy",
        out,
      ];
    } else {
      // Inputs are indexed in this order:
      //   0 = video
      //   1 = narration (if present)
      //   2 = music (if present) — index slides depending on narration presence
      args = ["-y", "-i", videoIn];
      let narrIdx = -1;
      let musicIdx = -1;
      let cursor = 1;
      if (hasNarration) {
        args.push("-stream_loop", "0", "-i", narrationIn);
        narrIdx = cursor++;
      }
      if (hasMusic) {
        // -stream_loop -1 = infinite loop; combined with -shortest trim
        args.push("-stream_loop", "-1", "-i", musicIn);
        musicIdx = cursor++;
      }

      // Build filter_complex:
      //   - narration: pass through, label "narr"
      //   - music: drop volume (-12 dB default), label "mus"
      //   - amix narration+music → label "mix"
      //   - Or if only one input → its label IS the final mix
      const parts: string[] = [];
      const mixedLabels: string[] = [];
      if (hasNarration) {
        parts.push(`[${narrIdx}:a]volume=1.0[narr]`);
        mixedLabels.push("[narr]");
      }
      if (hasMusic) {
        // volume filter in dB: volume=-12dB
        parts.push(`[${musicIdx}:a]volume=${duckingDb}dB[mus]`);
        mixedLabels.push("[mus]");
      }
      if (mixedLabels.length === 2) {
        parts.push(
          `${mixedLabels.join("")}amix=inputs=2:duration=longest:weights=1 0.7[mix]`,
        );
      }
      const finalAudioLabel =
        mixedLabels.length === 2 ? "[mix]" : mixedLabels[0];

      args.push("-filter_complex", parts.join(";"));
      args.push(
        "-map", "0:v:0",
        "-map", finalAudioLabel,
        // Re-encode video for compatibility (Pexels source already H.264 but
        // re-mux to ensure clean MP4 with new audio):
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",       // trim to shortest stream (usually the video)
        "-movflags", "+faststart",
        out,
      );
    }
    report("merging", 50);

    // ─── 3. Run ffmpeg ─────────────────────────────────────────────────────
    const result = await runFfmpeg(args);
    if (result.exitCode !== 0) {
      throw new Error(
        `ffmpeg exited ${result.exitCode}: ${result.stderr.slice(-500)}`,
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
