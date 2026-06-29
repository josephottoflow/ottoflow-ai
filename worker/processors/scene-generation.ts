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
import { synthesizeNarration } from "@/lib/elevenlabs";
import { buildAiFirstPlan, type AiFirstClip } from "@/lib/ffmpeg-pipeline/orchestrator";
import { buildCommercialStyleBlock } from "@/lib/ffmpeg-pipeline/prompt-builder";
import type { AgentContext, SourceName, VideoStrategy } from "@/lib/ffmpeg-pipeline/types";

type Reporter = (step: string, progress: number) => void;

/**
 * A shared style preamble prepended to EVERY scene prompt so the 4 clips read
 * as one continuous video (consistent worldview, palette, camera language,
 * grade) — not four unrelated abstract clips. Paired with a shared seed below.
 */
function buildStyleBlock(
  strategy: VideoStrategy,
  palette: { primary?: string | null; secondary?: string | null; accent?: string | null } | null | undefined,
): string {
  const colors = [
    palette?.primary && `primary ${palette.primary}`,
    palette?.secondary && `secondary ${palette.secondary}`,
    palette?.accent && `accent ${palette.accent}`,
  ]
    .filter(Boolean)
    .join(", ");
  return [
    `Consistent visual language across the whole video — ${strategy.brand_worldview}.`,
    colors ? `Palette: ${colors}.` : "Restrained, cohesive palette.",
    "Vertical 9:16, steady slow cinematic camera motion, matched lighting, texture and color grade so every scene reads as one continuous piece.",
  ].join(" ");
}

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

  // Sprint 15 — Royalty-Free Library (source="pexels") records a stock-first job.
  const isPexels = data.source === "pexels";
  await admin
    .from("render_jobs")
    .update({
      merge_status: "merging",
      render_kind: isPexels ? "stock-first" : "ai-first",
      scene_provider: isPexels ? "pexels" : "seedance",
      video_strategy: strategy as unknown as Record<string, unknown>,
      progress: 5,
    })
    .eq("id", data.renderJobId);
  report("scene-gen", 5);

  try {
    await fs.mkdir(workDir, { recursive: true });
    const clips: AiFirstClip[] = [];
    const total = strategy.scenes.length;

    // Cross-scene consistency (Task 3): a shared style preamble + a single shared
    // seed across all scenes so the clips share look/grade/camera and read as one
    // video. Per-scene prompts still drive the distinct beat (problem→outcome).
    // Visual World V1: when the brand has a world, its stylePreamble + negative
    // prompt + seedFamily drive cross-scene consistency. Absent → the prior
    // strategy/palette-derived style block + per-strategy seed (unchanged).
    // Mode-gate (Video V1.1): commercial_story uses the human-first preamble +
    // universal negative (no people-ban). The certified path is UNCHANGED — same
    // Visual-World / palette-derived block as before → render 46bd40cd reproducible.
    const styleBlock =
      data.mode === "commercial_story"
        ? buildCommercialStyleBlock(
            (strategy.brand_worldview || strategy.scenes[0]?.prompt || "the recurring protagonist").slice(0, 160),
          )
        : data.branding?.stylePreamble
          ? `${data.branding.stylePreamble}${data.branding.negativePrompt ? ` Avoid: ${data.branding.negativePrompt}.` : ""}`
          : buildStyleBlock(strategy, data.branding?.palette ?? null);
    const sharedSeed =
      data.branding?.seedFamily ?? strategy.scenes[0]?.seed ?? Math.floor(Math.random() * 2 ** 31);

    // ─── Resume support (retry-spend protection) ──────────────────────────────
    // A retry of this job MUST NOT re-charge the provider for scenes a prior
    // attempt already generated + stored durably. Load existing scene_generations
    // rows that have a storage_url and skip those scenes' provider calls. With
    // attempts:1 (set at enqueue) this is belt-and-suspenders, but it also makes
    // a manual re-enqueue safe and idempotent.
    const { data: existingRows } = await admin
      .from("scene_generations")
      .select("scene_number, provider, storage_url, storage_key, duration_sec, width, height, attribution, metadata")
      .eq("render_job_id", data.renderJobId);
    const resumable = new Map<number, NonNullable<typeof existingRows>[number]>();
    for (const r of existingRows ?? []) {
      if (r.storage_url) resumable.set(r.scene_number as number, r);
    }

    // Cross-scene de-dup (P1): Pexels asset ids already used in this render.
    // Seeded from resumed rows so a retry doesn't reintroduce a duplicate.
    const usedPexelsIds: string[] = [];
    const recordPexelsId = (provider: string, meta: unknown) => {
      if (provider !== "pexels") return;
      const id = (meta as { pexelsId?: unknown } | null)?.pexelsId;
      if (id != null) usedPexelsIds.push(String(id));
    };
    for (const r of resumable.values()) {
      recordPexelsId((r.provider as string) ?? "", r.metadata);
    }

    for (let i = 0; i < total; i++) {
      const scene = strategy.scenes[i];

      // Sprint 39.2 — a scene the customer explicitly REPLACED must not reuse its
      // old cached clip; the override wins. Every other scene still resumes.
      const override = data.sceneOverrides?.[scene.sceneId];
      // Already generated + stored on a prior attempt → reuse, no provider spend.
      const cached = override ? undefined : resumable.get(scene.sceneId);
      if (cached?.storage_url) {
        clips.push({
          sceneId: scene.sceneId,
          url: cached.storage_url as string,
          durationSec: (cached.duration_sec as number) ?? scene.durationSec,
          width: (cached.width as number) ?? 720,
          height: (cached.height as number) ?? 1280,
          provider: (cached.provider as SourceName) ?? ("seedance" as SourceName),
          sourceId: `${cached.provider}-${data.renderJobId}-${scene.sceneId}`,
          attribution: (cached.attribution as string | null) ?? undefined,
        });
        report("scene-gen", 10 + Math.round(((i + 1) / total) * 60));
        continue;
      }

      const startedAt = Date.now();
      let fallbackReason: string | null = null;

      // Sprint 15 — Royalty-Free Library forces Pexels ONLY (no AI fallback, no AI
      // cost); the AI path is unchanged (Seedance-preferred with the usual fallbacks).
      const result = override
        ? // Customer-chosen clip (Replace Visual): skip search, treat exactly like
          // a provider result so the copy→upsert→clips path below is unchanged.
          ({
            url: override.url,
            provider: override.provider as SourceName,
            durationSec: override.durationSec,
            width: override.width ?? 720,
            height: override.height ?? 1280,
            costUsd: 0,
            attribution: override.attribution ?? null,
            metadata:
              override.sourceId != null ? { pexelsId: Number(override.sourceId) } : null,
          } as Awaited<ReturnType<typeof generateScene>>)
        : await generateScene(
            {
              // Shared style preamble + beat-specific prompt (Task 3).
              prompt: `${styleBlock} ${scene.prompt}`,
              durationSec: scene.durationSec,
              aspectRatio: data.aspectRatio ?? "9:16",
              seed: sharedSeed,
              brandIndustry: data.brandIndustry ?? null,
              topicTitle: data.topic,
              // Exclude stock clips already used by earlier scenes (P1 de-dup).
              excludeSourceIds: usedPexelsIds,
            },
            isPexels ? { forceProvider: "pexels" } : { preferProvider: "seedance" },
          );
      // Only the AI path treats a non-Seedance provider as a fall-through; for the
      // Royalty-Free path, Pexels IS the intended source.
      if (!isPexels && result.provider !== "seedance") {
        fallbackReason = `seedance unavailable → fell through to ${result.provider}`;
      }
      // Track the chosen stock asset so later scenes can't reuse it.
      recordPexelsId(result.provider, result.metadata);

      // Copy to durable storage (provider URLs — esp. Seedance — expire ~1h,
      // and ffmpeg-compose runs LATER). The compose step must read a durable
      // URL, so a failed/absent copy makes the scene UNUSABLE.
      let storageUrl: string | null = null;
      let storageKey: string | null = null;
      let copyError: string | null = null;
      try {
        const copied = await copyToR2(
          result.url,
          `${data.userId}/${data.renderJobId}/scene-${scene.sceneId}.mp4`,
        );
        if (copied) {
          storageUrl = copied.storageUrl;
          storageKey = copied.storageKey;
        } else {
          copyError = "R2 not configured";
        }
      } catch (err) {
        copyError = err instanceof Error ? err.message : String(err);
        captureFallback("scene-generation.r2_copy_failed", err, {
          renderJobId: data.renderJobId,
          sceneId: scene.sceneId,
        });
      }

      // Record the row first (so the failure is visible in scene_generations),
      // combining any provider fall-through note with the copy error.
      const rowReason =
        [fallbackReason, copyError && `R2 copy failed: ${copyError}`]
          .filter(Boolean)
          .join("; ") || null;
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
          seed: String(sharedSeed),
          duration_sec: result.durationSec,
          width: result.width,
          height: result.height,
          generation_time_ms: Date.now() - startedAt,
          cost_usd: result.costUsd ?? null,
          fallback_reason: rowReason,
          attribution: result.attribution ?? null,
          metadata: (result.metadata ?? null) as Record<string, unknown> | null,
        },
        { onConflict: "render_job_id,scene_number" },
      );

      // Durability gate — fail fast + visibly rather than letting an expiring
      // provider URL flow into compose and 404 minutes later.
      if (!storageUrl) {
        throw new Error(
          `scene ${scene.sceneId}: no durable storage_url (${copyError ?? "unknown"}). ` +
            `Provider (${result.provider}) URL would expire before compose — failing fast. ` +
            `Ensure R2_* env is set on the worker.`,
        );
      }

      clips.push({
        sceneId: scene.sceneId,
        url: storageUrl,
        durationSec: result.durationSec,
        width: result.width,
        height: result.height,
        provider: result.provider as SourceName,
        sourceId: `${result.provider}-${data.renderJobId}-${scene.sceneId}`,
        attribution: result.attribution,
      });

      report("scene-gen", 10 + Math.round(((i + 1) / total) * 60));
    }

    // ─── P1 fix (Sprint 34) · Narration ──────────────────────────────────────
    // Root cause of the "silent video" bug: this path (the primary Create-Video
    // flow, /api/video/generate) never synthesized voice, so the composer muxed
    // no audio while the UI promised "with audio". Fix = synthesize here, right
    // before the plan is built, REUSING the same ElevenLabs helper as
    // /api/generate (no second pipeline). The narration is an ElevenLabs
    // data: URL, which the composer's downloadTo() already handles (proven path).
    //
    // BEST-EFFORT BY DESIGN: agent 11 only muxes when plan.audio.narrationUrl is
    // non-empty (it skips otherwise), so if ELEVENLABS_API_KEY is missing or
    // over-quota this degrades to the prior (silent) behavior instead of failing
    // the render — zero regression. Caption text is the script beat per scene, so
    // voice and on-screen captions stay aligned.
    let narrationUrl: string | null = data.narrationUrl ?? null;
    if (!narrationUrl) {
      const narrationText =
        (strategy.scenes.map((s) => s.caption?.trim()).filter(Boolean).join(". ") ||
          strategy.video_concept).slice(0, 1500);
      try {
        const voice = await synthesizeNarration({ text: narrationText });
        narrationUrl = voice.audioDataUrl;
        report("narration", 73);
      } catch (err) {
        // Unconfigured / over-quota → ship without narration (no regression).
        captureFallback("scene-gen.narration_failed", err, {
          renderJobId: data.renderJobId,
        });
      }
    }

    // Build the AI-first CompositionPlan and hand off to FFmpeg (ADR-002).
    const plan = buildAiFirstPlan({
      ctx,
      strategy,
      clips,
      narrationUrl,
      musicUrl: data.musicUrl ?? null,
      branding: data.branding,
      aspect: data.aspectRatio ?? "9:16",
    });
    report("plan", 75);

    await ffmpegComposeQueue().add("compose", {
      plan,
      // Unified Drive contract (phase3↔video merge): pass the connected-account
      // id only; ffmpeg-compose fetches+decrypts the token server-side. R2 stays
      // the primary store, so this is null in the standard V1 flow.
      connectedAccountId: data.connectedAccountId ?? null,
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
