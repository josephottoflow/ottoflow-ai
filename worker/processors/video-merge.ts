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
    //
    // Goal: produce one MP4 with the video stream + a single audio track that
    // mixes narration (full volume) and music (ducked). No looping — if music
    // ends before narration/video, the rest just plays narration. Keeps the
    // filter graph simple + bounded so ffmpeg can't hang on infinite streams.
    //
    // Stream copy when there's nothing to mix.
    let args: string[];
    if (!hasNarration && !hasMusic) {
      args = ["-y", "-i", videoIn, "-c", "copy", out];
    } else if (hasNarration && !hasMusic) {
      // Single audio path — no filter_complex needed.
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
      // Both narration + music — mix via amix.
      const musicLinearGain = Math.pow(10, duckingDb / 20);
      args = [
        "-y",
        "-i", videoIn,
        "-i", narrationIn,
        "-i", musicIn,
        "-filter_complex",
        // narration full, music ducked, then amix. duration=first follows
        // the narration timeline — music gets cut if longer, silent past
        // narration if shorter. -shortest at encoder still caps to video.
        `[1:a]volume=1.0[narr];[2:a]volume=${musicLinearGain.toFixed(3)}[mus];[narr][mus]amix=inputs=2:duration=first[mix]`,
        "-map", "0:v:0",
        "-map", "[mix]",
        // Stream copy the video — Pexels MP4 is already H.264 + yuv420p so
        // we skip re-encode. ~10x faster + avoids libx264 OOM risk on the
        // worker. Audio is always re-encoded because we mixed it.
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        out,
      ];
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
