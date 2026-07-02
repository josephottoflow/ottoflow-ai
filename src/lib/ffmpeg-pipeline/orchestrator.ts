/**
 * Orchestrator — wires Agents 1-10 in the SSE route.
 *
 * The function returns a CompositionPlan that's safe to enqueue. The route
 * layer is responsible for:
 *   1. Generating narration MP3 via ElevenLabs (uses CompositionPlan.audio).
 *   2. Picking a music track via Jamendo.
 *   3. Enqueueing `ffmpeg-compose` with the plan as the job payload.
 *
 * Every agent's output is logged as a Sentry breadcrumb via ctx.log so the
 * stage where a job degraded shows up in the trace. Each agent is wrapped in
 * a per-stage try/catch — when one fails, the orchestrator records the
 * failure to scene_candidates (where applicable) and throws so /api/generate
 * can stream a `type:error` SSE event.
 */
import { runContentStrategist } from "./agents/01-content-strategist";
import { runScriptWriter } from "./agents/02-script-writer";
import { runScenePlanner } from "./agents/03-scene-planner";
import { runMultiSourceSearch } from "./agents/04-multi-source-search";
import { runVideoAnalysis } from "./agents/05-video-analysis";
import { runDiversity } from "./agents/06-diversity";
import { runVisualConsistency } from "./agents/07-visual-consistency";
import { runCaptionCompression } from "./agents/08-caption-compression";
import { runTiming } from "./agents/09-timing";
import { runVideoEditor } from "./agents/10-video-editor";
import { runFfmpegComposer } from "./agents/11-ffmpeg-composer";

import type {
  AgentContext,
  CompositionPlan,
  CompositionPlanScene,
  TimedCaption,
  TimingPlan,
  EditDecision,
  SelectedClip,
  StrategistOutput,
  ScriptOutput,
  ScenePlan,
  SourceName,
  Emotion,
  EmotionalBeat,
  VideoStrategy,
  SceneRole,
} from "./types";

export interface OrchestratorInput {
  ctx: AgentContext;
  targetDurationSec: number; // 30-60
  // Audio resolved by the SSE route BEFORE calling the orchestrator (the
  // narration duration drives Agent 9 Timing). When unknown, pass an
  // estimated value — the route can patch it post-generation before
  // enqueue if the actual narration came out longer.
  narrationDurationSec: number;
}

export interface OrchestratorOutput {
  plan: CompositionPlan;
}

// ─── Phase split ─────────────────────────────────────────────────────────────
// The route runs the SCRIPT phase first, synthesizes narration from
// script.fullText to learn the REAL duration, then runs the COMPOSITION phase
// with that exact duration so Agent 9 (Timing) has no estimate drift. The
// all-in-one runOrchestrator() below is a convenience for tests / standalone
// use that estimates the duration from the script itself.

export interface ScriptPhaseOutput {
  strategy: StrategistOutput;
  script: ScriptOutput;
  scenes: ScenePlan[];
}

/**
 * Agents 1-3: strategy → script → 4-scene plan. No network beyond Gemini.
 * The route calls this, then synthesizes narration from
 * `result.script.fullText` to learn the true duration.
 */
export async function runScriptPhase(
  ctx: AgentContext,
  targetDurationSec: number,
): Promise<ScriptPhaseOutput> {
  ctx.log("orchestrator.scriptPhase.start", { topic: ctx.topic });

  const strategy = await runContentStrategist(
    { topic: ctx.topic, brandIndustry: ctx.brandIndustry ?? null },
    ctx,
  );
  const script = await runScriptWriter({ strategy, targetDurationSec }, ctx);
  const { scenes } = await runScenePlanner(
    { script, emotionalArc: strategy.emotionalArc, sceneCount: 4 },
    ctx,
  );

  ctx.log("orchestrator.scriptPhase.done", { scenes: scenes.length });
  return { strategy, script, scenes };
}

export interface CompositionPhaseInput {
  ctx: AgentContext;
  strategy: StrategistOutput;
  script: ScriptOutput;
  scenes: ScenePlan[];
  narrationDurationSec: number;
}

/**
 * Agents 4-10: search → analysis → diversity → consistency → captions →
 * timing → editor. Produces the CompositionPlan (audio URLs still blank —
 * the route patches plan.audio.{narrationUrl,musicUrl} before enqueue).
 *
 * Agents 11 (compose) + 12 (QC) run in the worker, NOT here.
 */
export async function runCompositionPhase(
  input: CompositionPhaseInput,
): Promise<OrchestratorOutput> {
  const { ctx, strategy, script, scenes, narrationDurationSec } = input;

  // Agent 4 — Multi-Source Search (fan out per scene)
  const searchResults = await Promise.all(
    scenes.map((scene) => runMultiSourceSearch({ scene, perSourceLimit: 10 }, ctx)),
  );

  // Agent 5 — Video Analysis (fan out per scene). Vision is gated by budget:
  // premium → on, otherwise heuristic-only.
  const useVision = ctx.budgetMode === "premium";
  const analyzed = await Promise.all(
    scenes.map((scene, i) =>
      runVideoAnalysis(
        { scene, candidates: searchResults[i].candidates, useVision },
        ctx,
      ),
    ),
  );
  // Order analyzed[].scored to match scene order (already is, but be explicit).
  const perSceneScored = scenes.map(
    (s) => analyzed.find((a) => a.sceneId === s.sceneId)?.scored ?? [],
  );

  // Agent 6 — Diversity (single asset_history fetch across all scenes)
  const { perScenePenalized } = await runDiversity(
    { userId: ctx.userId, perSceneCandidates: perSceneScored, lookbackJobs: 100 },
    ctx,
  );

  // Agent 7 — Visual Consistency + final per-scene selection
  const { selectionsBySceneId } = await runVisualConsistency(
    {
      perSceneCandidates: perScenePenalized,
      desiredStyle: scenes[0]?.visualStyle ?? "cinematic",
    },
    ctx,
  );

  // Agent 8 — Caption Compression (one Gemini call for all scenes)
  const { captions } = await runCaptionCompression({ scenes }, ctx);
  const captionById = new Map<number, TimedCaption>(
    captions.map((c) => [c.sceneId, c]),
  );

  // Agent 9 — Timing (re-base scenes onto the real narration duration)
  const { perScene: timings, totalDurationMs } = await runTiming(
    { scenes, narrationDurationSec },
    ctx,
  );
  const timingById = new Map<number, TimingPlan>(
    timings.map((t) => [t.sceneId, t]),
  );

  // Agent 10 — Video Editor (zoom/pan/transition/grade per scene)
  const { decisions, globalGrade } = await runVideoEditor(
    {
      scenes,
      timings,
      emotionalArc: strategy.emotionalArc,
      baseStyle: scenes[0]?.visualStyle ?? "cinematic",
    },
    ctx,
  );
  const editById = new Map<number, EditDecision>(
    decisions.map((d) => [d.sceneId, d]),
  );

  // ─── Assemble the CompositionPlan ──────────────────────────────────────────
  const compositionScenes: CompositionPlanScene[] = scenes.map((scene) => {
    const clip: SelectedClip | undefined = selectionsBySceneId[scene.sceneId];
    if (!clip) {
      throw new Error(
        `No clip selected for scene ${scene.sceneId} — Agent 4 returned 0 usable candidates across all sources`,
      );
    }
    const caption = captionById.get(scene.sceneId);
    const timing = timingById.get(scene.sceneId);
    const edit = editById.get(scene.sceneId);
    if (!caption || !timing || !edit) {
      throw new Error(
        `Incomplete plan for scene ${scene.sceneId}: caption=${!!caption} timing=${!!timing} edit=${!!edit}`,
      );
    }
    return { plan: scene, clip, caption, timing, edit };
  });

  const plan: CompositionPlan = {
    version: "ffmpeg-v2",
    renderJobId: ctx.renderJobId,
    userId: ctx.userId,
    topic: ctx.topic,
    scenes: compositionScenes,
    audio: {
      narrationUrl: "", // patched by SSE route after ElevenLabs returns
      musicUrl: "",     // patched by SSE route after Jamendo returns
      musicDuckingDb: -12,
    },
    output: {
      width: 1080,
      height: 1920,
      fps: 30,
      durationMs: totalDurationMs,
    },
    globalGrade,
    artifacts: { strategy, script },
  };

  ctx.log("orchestrator.compositionPhase.done", {
    sceneCount: plan.scenes.length,
    durationMs: plan.output.durationMs,
    grade: plan.globalGrade,
  });
  return { plan };
}

/**
 * All-in-one convenience: runs both phases back to back, estimating the
 * narration duration from the generated script (no real ElevenLabs call).
 * Useful for tests + standalone runs. The PRODUCTION route uses the two
 * phases directly so Agent 9 gets the true narration duration.
 */
export async function runOrchestrator(
  input: OrchestratorInput,
): Promise<OrchestratorOutput> {
  const { ctx, targetDurationSec, narrationDurationSec } = input;
  ctx.log("orchestrator.start", { topic: ctx.topic });

  const { strategy, script, scenes } = await runScriptPhase(ctx, targetDurationSec);

  // Prefer the caller's measured narration duration; otherwise fall back to
  // the script's own estimate.
  const durSec = narrationDurationSec > 0 ? narrationDurationSec : script.totalDurationSec;

  return runCompositionPhase({ ctx, strategy, script, scenes, narrationDurationSec: durSec });
}

// ─── Ottoflow Video V1 — AI-first composition plan builder ───────────────────
// The AI-first path REPLACES Agents 4-7 (search/score/select) with one
// Seedance clip per VideoStrategy scene, but reuses the exact CompositionPlan
// contract so Agents 11 (compose) + 12 (QC) in the worker run UNCHANGED
// (preserves ADR-002). Captions/timing/edits are derived deterministically
// from the strategy — no narration-driven agents, no second creative engine.

const ROLE_EMOTION: Record<SceneRole, Emotion> = {
  // Certified 4-beat (unchanged).
  problem: "anxious",
  tension: "urgent",
  solution: "hopeful",
  outcome: "confident",
  // Commercial_story 6-beat (additive).
  hook: "curious",
  visualized_pain: "anxious",
  reveal: "hopeful",
  proof: "confident",
};

/** A generated scene clip (already copied to durable storage by the worker). */
export interface AiFirstClip {
  sceneId: number;
  url: string;
  durationSec: number;
  width: number;
  height: number;
  provider: SourceName;
  sourceId?: string;
  attribution?: string;
}

export interface AiFirstPlanInput {
  ctx: AgentContext;
  strategy: VideoStrategy;
  clips: AiFirstClip[];
  narrationUrl?: string | null;
  musicUrl?: string | null;
  /** Sprint 45 — per-scene narration segments (Audio Timing). Optional. */
  narrationSegments?: { sceneId: number; url: string }[] | null;
  /** Optional deterministic branding (logo overlay + CTA end card). */
  branding?: CompositionPlan["branding"];
  /** Output aspect (Video V1.1). Absent → "9:16" = the certified 1080×1920. */
  aspect?: "9:16" | "16:9" | "1:1";
}

/** Output canvas dims per aspect, preserving the certified 9:16 = 1080×1920. */
function outputDimsForAspect(aspect: "9:16" | "16:9" | "1:1"): { width: number; height: number } {
  if (aspect === "16:9") return { width: 1920, height: 1080 };
  if (aspect === "1:1") return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 }; // 9:16 (default, certified)
}

/** Word-wrap a caption to ≤2 lines of ≤22 chars (matches Agent 8 limits). */
function wrapCaption(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 22) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}

/**
 * Build a CompositionPlan from a frozen VideoStrategy + its generated clips.
 * Hard cuts (transition "cut") for the V1 / 2GB-RAM target; xfade is a V2
 * change once RAM ≥ 4GB.
 */
export function buildAiFirstPlan(input: AiFirstPlanInput): CompositionPlan {
  const { ctx, strategy, clips } = input;
  const clipBySceneId = new Map(clips.map((c) => [c.sceneId, c]));

  let cursorMs = 0;
  const scenes: CompositionPlanScene[] = strategy.scenes.map((s) => {
    const clip = clipBySceneId.get(s.sceneId);
    if (!clip) {
      throw new Error(`buildAiFirstPlan: no generated clip for scene ${s.sceneId}`);
    }
    // Clamp to the PLANNED per-scene duration. Seedance returns exactly the
    // requested length (≤ plan), so it is unaffected. Pexels fallback clips keep
    // their NATIVE length (11s–36s); without this clamp a single stock clip
    // dominated the timeline (cert 2594ea2e: scene-3 = 35.5s, total 58.6s vs a
    // 20s plan). Min() trims fallbacks back to the scene's intended duration.
    const durMs = Math.round(
      Math.min(clip.durationSec || s.durationSec, s.durationSec) * 1000,
    );
    const startMs = cursorMs;
    const endMs = cursorMs + durMs;
    cursorMs = endMs;

    const plan: ScenePlan = {
      sceneId: s.sceneId,
      narration: "",
      visualGoal: s.prompt,
      emotion: ROLE_EMOTION[s.role],
      searchIntent: s.role,
      visualStyle: "cinematic",
      keywords: [],
      startMs,
      endMs,
    };

    const selected: SelectedClip = {
      source: clip.provider,
      sourceId: clip.sourceId ?? `${clip.provider}-${ctx.renderJobId}-${s.sceneId}`,
      url: clip.url,
      width: clip.width,
      height: clip.height,
      durationSec: clip.durationSec || s.durationSec,
      query: s.role,
      attribution: clip.attribution ?? `via ${clip.provider}`,
      // AI-first clips are generated to brief → neutral "perfect" scores so the
      // existing QC math treats them as selected without a candidate pool.
      score: 10,
      reason: "ai-first generated scene",
      relevance: 1,
      quality: 1,
      framing: 1,
      motion: 0.5,
      diversityPenalty: 0,
      consistencyScore: 1,
      finalScore: 10,
    };

    const caption: TimedCaption = {
      sceneId: s.sceneId,
      text: s.caption,
      startMs,
      endMs,
      lineBreaks: wrapCaption(s.caption),
    };

    const timing: TimingPlan = {
      sceneId: s.sceneId,
      videoStartMs: startMs,
      videoEndMs: endMs,
      transitionInMs: 0,
      transitionOutMs: 0,
      kenBurnsMs: durMs,
    };

    const edit: EditDecision = {
      sceneId: s.sceneId,
      zoom: { from: 1, to: 1.08 },
      pan: { fromX: 0.5, fromY: 0.5, toX: 0.5, toY: 0.5 },
      transition: "cut",
      transitionDurationMs: 0,
      grade: "natural",
    };

    return { plan, clip: selected, caption, timing, edit };
  });

  const totalDurationMs = cursorMs;
  const totalDurationSec = Math.round(totalDurationMs / 1000);

  // Minimal synthesized artifacts so the composer/QC/regen path (which reads
  // plan.artifacts.strategy.emotionalArc) works unchanged.
  const emotionalArc: EmotionalBeat[] = strategy.scenes.map((s, i) => ({
    startPct: i / Math.max(1, strategy.scenes.length),
    emotion: ROLE_EMOTION[s.role],
    intensity: 0.5 + i * 0.1,
  }));

  const section = (s: { caption: string }, startMs: number, endMs: number) => ({
    text: s.caption,
    startMs,
    endMs,
  });
  const sc = strategy.scenes;
  const artifactsStrategy: StrategistOutput = {
    hookStrategy: strategy.video_concept,
    narrativeStrategy: `${strategy.visual_tension} → ${strategy.visual_metaphor}`,
    ctaStrategy: strategy.brand_worldview,
    audienceProfile: ctx.brandIndustry ?? "general",
    emotionalArc,
  };
  const artifactsScript: ScriptOutput = {
    hook: section(sc[0] ?? { caption: "" }, 0, totalDurationMs),
    problem: section(sc[0] ?? { caption: "" }, scenes[0]?.timing.videoStartMs ?? 0, scenes[0]?.timing.videoEndMs ?? 0),
    value: section(sc[2] ?? { caption: "" }, scenes[2]?.timing.videoStartMs ?? 0, scenes[2]?.timing.videoEndMs ?? 0),
    conclusion: section(sc[3] ?? { caption: "" }, scenes[3]?.timing.videoStartMs ?? 0, scenes[3]?.timing.videoEndMs ?? 0),
    cta: section(sc[3] ?? { caption: "" }, scenes[3]?.timing.videoStartMs ?? 0, scenes[3]?.timing.videoEndMs ?? 0),
    totalDurationSec,
    fullText: strategy.video_concept,
  };

  ctx.log("orchestrator.aiFirstPlan.done", {
    sceneCount: scenes.length,
    durationMs: totalDurationMs,
    providers: scenes.map((s) => s.clip.source),
  });

  return {
    version: "ffmpeg-v2",
    renderJobId: ctx.renderJobId,
    userId: ctx.userId,
    topic: ctx.topic,
    scenes,
    audio: {
      narrationUrl: input.narrationUrl ?? "",
      musicUrl: input.musicUrl ?? "",
      musicDuckingDb: -12,
      ...(input.narrationSegments?.length
        ? { narrationSegments: input.narrationSegments }
        : {}),
    },
    output: { ...outputDimsForAspect(input.aspect ?? "9:16"), fps: 30, durationMs: totalDurationMs },
    globalGrade: "natural",
    artifacts: { strategy: artifactsStrategy, script: artifactsScript },
    ...(input.branding ? { branding: input.branding } : {}),
  };
}

// Re-export for the BullMQ worker — Agent 11 lives in agents/.
export { runFfmpegComposer };
