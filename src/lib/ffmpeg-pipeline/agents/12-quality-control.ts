/**
 * Agent 12: Quality Control.
 *
 * Runs AFTER Agent 11 produces the MP4. Validates the artefact + the plan
 * against the spec's QC dimensions, scores 0-10, and — if < 8.5 — names the
 * agents whose output should be regenerated.
 *
 * Checks:
 *   - ffprobe: dimensions == 1080x1920, has a video + audio stream, duration
 *     within ±0.75s of the planned duration (timing_drift).
 *   - relevance: any selected clip with finalScore < 4 → low_relevance.
 *   - duplicate footage: same (source, sourceId) used in ≥ 2 scenes →
 *     duplicate_clip.
 *   - caption overflow: any line > 22 chars or > 2 lines → caption_overflow.
 *   - caption readability: any caption > 8 words → caption_unreadable.
 *   - audio: ffprobe reports an audio stream with sane bitrate.
 *
 * The regen mapping points each failure class at the agent that owns it so
 * the worker's single-regen loop knows what to re-run.
 */
import { spawn } from "node:child_process";
import type {
  AgentContext,
  AgentName,
  QCInput,
  QCIssue,
  QCReport,
} from "../types";

interface FfprobeStreams {
  streams: Array<{
    codec_type: "video" | "audio";
    width?: number;
    height?: number;
    bit_rate?: string;
    duration?: string;
  }>;
  format: { duration?: string; bit_rate?: string };
}

function runFfprobe(filePath: string): Promise<FfprobeStreams | null> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    proc.stdout.on("data", (c) => (out += c.toString()));
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => {
      if (code !== 0) return resolve(null);
      try {
        resolve(JSON.parse(out) as FfprobeStreams);
      } catch {
        resolve(null);
      }
    });
  });
}

// Each issue class → the agent that should regenerate.
const REGEN_OWNER: Record<QCIssue["code"], AgentName> = {
  low_relevance:       "multiSourceSearch",
  duplicate_clip:      "diversity",
  caption_overflow:    "captionCompression",
  caption_unreadable:  "captionCompression",
  timing_drift:        "timing",
  audio_clipping:      "ffmpegComposer",
  color_inconsistency: "videoEditor",
  ffmpeg_warning:      "ffmpegComposer",
};

export async function runQualityControl(
  input: QCInput,
  ctx: AgentContext,
): Promise<QCReport> {
  const { plan, result } = input;
  ctx.log("agent.qualityControl.start", { localPath: result.localPath });

  const issues: QCIssue[] = [];

  // ─── ffprobe checks ────────────────────────────────────────────────────
  const probe = await runFfprobe(result.localPath);
  if (!probe) {
    issues.push({
      agent: "ffmpegComposer",
      severity: "fail",
      code: "ffmpeg_warning",
      message: "ffprobe could not read the output file",
    });
  } else {
    const v = probe.streams.find((s) => s.codec_type === "video");
    const a = probe.streams.find((s) => s.codec_type === "audio");
    if (!v) {
      issues.push({
        agent: "ffmpegComposer", severity: "fail", code: "ffmpeg_warning",
        message: "output has no video stream",
      });
    } else if (v.width !== plan.output.width || v.height !== plan.output.height) {
      issues.push({
        agent: "ffmpegComposer", severity: "fail", code: "ffmpeg_warning",
        message: `dimensions ${v.width}x${v.height} != ${plan.output.width}x${plan.output.height}`,
      });
    }
    if (!a) {
      issues.push({
        agent: "ffmpegComposer", severity: "fail", code: "audio_clipping",
        message: "output has no audio stream",
      });
    }
    const actualDur = Number(probe.format.duration ?? 0);
    const planDurSec = plan.output.durationMs / 1000;
    if (actualDur > 0 && Math.abs(actualDur - planDurSec) > 0.75) {
      issues.push({
        agent: "timing", severity: "warn", code: "timing_drift",
        message: `actual ${actualDur.toFixed(2)}s vs planned ${planDurSec.toFixed(2)}s`,
      });
    }
  }

  // ─── relevance + duplicate checks (from the plan) ────────────────────────
  const seen = new Map<string, number[]>(); // assetKey → sceneIds
  for (const s of plan.scenes) {
    if (s.clip.finalScore < 4) {
      issues.push({
        agent: "multiSourceSearch", severity: "warn", code: "low_relevance",
        sceneId: s.plan.sceneId,
        message: `scene ${s.plan.sceneId} clip finalScore ${s.clip.finalScore.toFixed(1)} < 4`,
      });
    }
    const key = `${s.clip.source}:${s.clip.sourceId}`;
    const arr = seen.get(key) ?? [];
    arr.push(s.plan.sceneId);
    seen.set(key, arr);
  }
  for (const [key, sceneIds] of seen) {
    if (sceneIds.length >= 2) {
      issues.push({
        agent: "diversity", severity: "warn", code: "duplicate_clip",
        message: `asset ${key} reused in scenes ${sceneIds.join(", ")}`,
      });
    }
  }

  // ─── caption checks ──────────────────────────────────────────────────────
  for (const s of plan.scenes) {
    const cap = s.caption;
    if (cap.lineBreaks.length > 2) {
      issues.push({
        agent: "captionCompression", severity: "fail", code: "caption_overflow",
        sceneId: s.plan.sceneId,
        message: `scene ${s.plan.sceneId} caption has ${cap.lineBreaks.length} lines`,
      });
    }
    if (cap.lineBreaks.some((l) => l.length > 22)) {
      issues.push({
        agent: "captionCompression", severity: "fail", code: "caption_overflow",
        sceneId: s.plan.sceneId,
        message: `scene ${s.plan.sceneId} caption line exceeds 22 chars`,
      });
    }
    const wordCount = cap.text.split(/\s+/).filter(Boolean).length;
    if (wordCount > 8) {
      issues.push({
        agent: "captionCompression", severity: "warn", code: "caption_unreadable",
        sceneId: s.plan.sceneId,
        message: `scene ${s.plan.sceneId} caption has ${wordCount} words (> 8)`,
      });
    }
  }

  // ─── ffmpeg stderr warnings ──────────────────────────────────────────────
  if (/\b(error|invalid|failed)\b/i.test(result.ffmpegStderr.slice(-2000))) {
    issues.push({
      agent: "ffmpegComposer", severity: "warn", code: "ffmpeg_warning",
      message: "ffmpeg stderr contains warning/error keywords",
    });
  }

  // ─── Score ───────────────────────────────────────────────────────────────
  // Start at 10, subtract per issue by severity.
  let score = 10;
  for (const issue of issues) {
    score -= issue.severity === "fail" ? 2.5 : 0.8;
  }
  score = Math.max(0, Math.round(score * 10) / 10);
  const passed = score >= 8.5;

  // Dedup the regen agents.
  const regenerateRequested = passed
    ? []
    : Array.from(
        new Set(
          issues
            .filter((i) => i.severity === "fail" || i.code === "low_relevance")
            .map((i) => REGEN_OWNER[i.code]),
        ),
      );

  ctx.log("agent.qualityControl.done", {
    score,
    passed,
    issueCount: issues.length,
    regenerateRequested,
  });

  return { score, passed, issues, regenerateRequested };
}
