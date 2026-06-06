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

// Re-export for the BullMQ worker — Agent 11 lives in agents/.
export { runFfmpegComposer };
