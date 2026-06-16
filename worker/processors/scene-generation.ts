/**
 * scene-generation processor (Ottoflow Video V1 — AI-first path).
 *
 * Consumes a frozen VideoStrategy and runs the slow per-scene work off the
 * Vercel SSE ceiling:
 *
 *   for each strategy scene:
 *     registry.generateScene({ preferProvider: "seedance" })  ← Seedance, else
 *                                Runway → Luma → Pexels (never 500s)
 *     copy clip → Cloudflare R2 (provider URLs expire ~1h)
 *     upsert scene_generations (provider, urls, seed, timing, fallback_reason)
 *   buildAiFirstPlan(strategy, clips)  → CompositionPlan
 *   enqueue `ffmpeg-compose`           ← FFmpeg owns composition (ADR-002)
 *
 * Seedance gets ONLY the abstract scene prompt — brand logo/headshot/CTA are
 * never sent to a model; branding is deterministic in FFmpeg.
 *
 * Progress (render_jobs.progress): 5 start → 10..70 per scene → 75 plan →
 * 80 enqueued. The downstream ffmpeg-compose job then drives 5→100.
 */
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase";
import { captureFallback } from "@/lib/observability";
import { ffmpegComposeQueue, type SceneGenerationJobData } from "@/lib/queue";
import { generateScene } from "@/lib/video-providers/registry";
import { uploadToR2, isR2Configured } from "@/lib/ffmpeg-pipeline/r2";
import { buildAiFirstPlan, type AiFirstClip } from "@/lib/ffmpeg-pipeline/orchestrator";
import type { AgentContext, SourceName } from "@/lib/ffmpeg-pipeline/types";

type Reporter = (step: string, progress: number) => void;

function makeCtx(data: SceneGenerationJobData): AgentContext {
  return {
    renderJobId: data.renderJobId,
    userId: data.userId,
    topic: data.topic,
    brandId: data.brandId ?? null,
    brandIndustry: data.brandIndustry ?? null,
    includeAiScenes: true,
    budgetMode: "standard",
    log: () => {},
  };
}

/** Download a clip URL to disk then copy to R2; returns the durable URL + key. */
async function copyToR2(
  url: string,
  objectKey: string,
): Promise<{ storageUrl: string; storageKey: string } | null> {
  if (!isR2Configured()) return null;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`scene clip download failed ${res.status} for ${url}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const up = await uploadToR2(objectKey, bytes, "video/mp4");
  return { storageUrl: up.publicUrl, storageKey: up.objectKey };
}

export async function processSceneGeneration(
  data: SceneGenerationJobData,
  report: Reporter,
): Promise<{ ok: true; renderJobId: string; scenes: number }> {
  const admin = createAdminClient();
  const ctx = makeCtx(data);
  const { strategy } = data;
  const workDir = path.join(tmpdir(), `scenegen-${data.renderJobId}-${randomUUID()}`);

  await admin
    .from("render_jobs")
    .update({
      merge_status: "merging",
      render_kind: "ai-first",
      scene_provider: "seedance",
      video_strategy: strategy as unknown as Record<string, unknown>,
      progress: 5,
    })
    .eq("id", data.renderJobId);
  report("scene-gen", 5);

  try {
    await fs.mkdir(workDir, { recursive: true });
    const clips: AiFirstClip[] = [];
    const total = strategy.scenes.length;

    for (let i = 0; i < total; i++) {
      const scene = strategy.scenes[i];
      const startedAt = Date.now();
      let fallbackReason: string | null = null;

      const result = await generateScene(
        {
          prompt: scene.prompt,
          durationSec: scene.durationSec,
          aspectRatio: "9:16",
          seed: scene.seed,
          brandIndustry: data.brandIndustry ?? null,
          topicTitle: data.topic,
        },
        { preferProvider: "seedance" },
      );
      if (result.provider !== "seedance") {
        fallbackReason = `seedance unavailable → fell through to ${result.provider}`;
      }

      // Copy to durable storage (Seedance URLs expire). Fall back to the
      // provider URL if R2 isn't configured.
      let storageUrl: string | null = null;
      let storageKey: string | null = null;
      try {
        const copied = await copyToR2(
          result.url,
          `${data.userId}/${data.renderJobId}/scene-${scene.sceneId}.mp4`,
        );
        if (copied) {
          storageUrl = copied.storageUrl;
          storageKey = copied.storageKey;
        }
      } catch (err) {
        captureFallback("scene-generation.r2_copy_failed", err, {
          renderJobId: data.renderJobId,
          sceneId: scene.sceneId,
        });
      }

      const durableUrl = storageUrl ?? result.url;

      await admin.from("scene_generations").upsert(
        {
          render_job_id: data.renderJobId,
          scene_number: scene.sceneId,
          prompt: scene.prompt,
          shot_type: scene.role,
          provider: result.provider,
          clip_url: result.url,
          storage_url: storageUrl,
          storage_key: storageKey,
          seed: String(scene.seed),
          duration_sec: result.durationSec,
          width: result.width,
          height: result.height,
          generation_time_ms: Date.now() - startedAt,
          cost_usd: result.costUsd ?? null,
          fallback_reason: fallbackReason,
          attribution: result.attribution ?? null,
          metadata: (result.metadata ?? null) as Record<string, unknown> | null,
        },
        { onConflict: "render_job_id,scene_number" },
      );

      clips.push({
        sceneId: scene.sceneId,
        url: durableUrl,
        durationSec: result.durationSec,
        width: result.width,
        height: result.height,
        provider: result.provider as SourceName,
        sourceId: `${result.provider}-${data.renderJobId}-${scene.sceneId}`,
        attribution: result.attribution,
      });

      report("scene-gen", 10 + Math.round(((i + 1) / total) * 60));
    }

    // Build the AI-first CompositionPlan and hand off to FFmpeg (ADR-002).
    const plan = buildAiFirstPlan({
      ctx,
      strategy,
      clips,
      narrationUrl: data.narrationUrl ?? null,
      musicUrl: data.musicUrl ?? null,
      branding: data.branding,
    });
    report("plan", 75);

    await ffmpegComposeQueue().add("compose", {
      plan,
      gdriveAccessToken: data.gdriveAccessToken ?? null,
    });
    await admin.from("render_jobs").update({ progress: 80 }).eq("id", data.renderJobId);
    report("enqueued", 80);

    return { ok: true, renderJobId: data.renderJobId, scenes: clips.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("render_jobs")
      .update({ merge_status: "failed", merge_error: message.slice(0, 1000) })
      .eq("id", data.renderJobId);
    throw err;
  } finally {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
