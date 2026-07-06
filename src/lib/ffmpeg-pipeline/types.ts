/**
 * ffmpeg-pipeline — IO contracts for all 12 agents (ADR-002).
 *
 * Every agent is a pure async function:
 *   type Agent<I, O> = (input: I, ctx: AgentContext) => Promise<O>;
 *
 * The orchestrator at orchestrator.ts wires them in order; the queue payload
 * the worker consumes (CompositionPlan) is the snapshot of Agents 1-10 output.
 * Agents 11-12 run inside the BullMQ worker.
 */

import type { RenderProfile } from "./render-profile";

// ─── Shared primitives ──────────────────────────────────────────────────────

export type SourceName =
  | "pexels"
  | "pixabay"
  | "mixkit"
  | "coverr"
  | "runway"     // opt-in
  | "luma"       // opt-in
  | "seedance";  // Video V1 AI-first scene generator (BytePlus ModelArk)

export type Emotion =
  | "curious"
  | "anxious"
  | "hopeful"
  | "confident"
  | "energetic"
  | "calm"
  | "urgent";

export type VisualStyle =
  | "cinematic"
  | "ugc"
  | "minimal"
  | "documentary"
  | "vibrant"
  | "moody";

export type Grade = "cinematic" | "warm" | "punchy" | "natural";

export type TransitionKind =
  | "fade"
  | "fadeblack"
  | "dissolve"
  | "wiperight"
  | "wipeleft"
  | "cut";

export type AgentName =
  | "strategist"
  | "scriptWriter"
  | "scenePlanner"
  | "multiSourceSearch"
  | "videoAnalysis"
  | "diversity"
  | "visualConsistency"
  | "captionCompression"
  | "timing"
  | "videoEditor"
  | "ffmpegComposer"
  | "qualityControl";

/**
 * Per-request context every agent receives. The orchestrator constructs
 * this once and passes it down. Avoid stuffing mutable state — pipeline-
 * level mutable state lives on the orchestrator, not the context.
 */
export interface AgentContext {
  renderJobId: string;
  userId: string;
  topic: string;
  brandId?: string | null;
  brandIndustry?: string | null;
  includeAiScenes: boolean;      // gates Runway/Luma in Agent 4
  budgetMode: "lean" | "standard" | "premium";
  // Concise logger the orchestrator wires (Sentry breadcrumb + console).
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

// ─── Agent 1: Content Strategist ────────────────────────────────────────────

export interface EmotionalBeat {
  startPct: number;   // 0-1, position in video
  emotion: Emotion;
  intensity: number;  // 0-1
}

export interface StrategistInput {
  topic: string;
  brandIndustry?: string | null;
}

export interface StrategistOutput {
  hookStrategy: string;
  narrativeStrategy: string;
  ctaStrategy: string;
  audienceProfile: string;
  emotionalArc: EmotionalBeat[];
}

// ─── Agent 2: Script Writer ─────────────────────────────────────────────────

export interface ScriptSection {
  text: string;
  startMs: number;
  endMs: number;
}

export interface ScriptInput {
  strategy: StrategistOutput;
  targetDurationSec: number; // 30-60
}

export interface ScriptOutput {
  hook: ScriptSection;
  problem: ScriptSection;
  value: ScriptSection;
  conclusion: ScriptSection;
  cta: ScriptSection;
  totalDurationSec: number;
  fullText: string;          // concatenated for ElevenLabs
}

// ─── Agent 3: Scene Planner ─────────────────────────────────────────────────

export interface ScenePlanInput {
  script: ScriptOutput;
  emotionalArc: EmotionalBeat[];
  sceneCount?: 4;            // fixed at 4 per spec, kept overridable for tests
}

export interface ScenePlan {
  sceneId: number;           // 1-based
  narration: string;         // text spoken during this scene
  visualGoal: string;        // "show a frustrated office worker"
  emotion: Emotion;
  searchIntent: string;      // semantic intent for Agent 4 query expansion
  visualStyle: VisualStyle;
  keywords: string[];
  startMs: number;
  endMs: number;
}

export interface ScenePlanOutput {
  scenes: ScenePlan[];
}

// ─── Agent 4: Multi-Source Search ───────────────────────────────────────────

export interface ClipCandidate {
  source: SourceName;
  sourceId: string;          // provider's native id (deduped on)
  url: string;               // direct MP4
  previewUrl?: string;       // smaller MP4 / GIF for Agent 5 vision
  thumbnailUrl?: string;     // poster image
  width: number;
  height: number;
  durationSec: number;
  query: string;             // which expanded query surfaced it
  attribution: string;
  metadata?: Record<string, unknown>;
}

export interface MultiSourceSearchInput {
  scene: ScenePlan;
  perSourceLimit: number;    // default 10 → 4 sources * 10 = 40 candidates
}

export interface MultiSourceSearchOutput {
  sceneId: number;
  candidates: ClipCandidate[];
  expandedQueries: string[]; // log: what variations Gemini produced
}

// ─── Agent 5: Video Analysis ────────────────────────────────────────────────

export interface AnalyzedCandidate extends ClipCandidate {
  score: number;             // 0-10
  reason: string;
  relevance: number;         // 0-1, how well the visual matches scene.visualGoal
  quality: number;           // 0-1, resolution + bitrate proxy
  framing: number;           // 0-1, vertical-crop suitability (face/subject in safe zone)
  motion: number;            // 0-1, motion-energy estimate (low = static, high = chaotic)
}

export interface VideoAnalysisInput {
  scene: ScenePlan;
  candidates: ClipCandidate[];
  useVision: boolean;        // false → heuristic only (budget mode)
}

export interface VideoAnalysisOutput {
  sceneId: number;
  scored: AnalyzedCandidate[];
}

// ─── Agent 6: Diversity ─────────────────────────────────────────────────────

export interface DiversityInput {
  userId: string;
  // Grouped by scene so the agent fetches asset_history ONCE for the whole
  // video instead of N times. Index i corresponds to scenes[i].
  perSceneCandidates: AnalyzedCandidate[][];
  lookbackJobs: number;      // default 100
}

export interface PenalizedCandidate extends AnalyzedCandidate {
  diversityPenalty: number;  // 0-1, subtracted from score
}

export interface DiversityOutput {
  // Same grouping as input.perSceneCandidates.
  perScenePenalized: PenalizedCandidate[][];
}

// ─── Agent 7: Visual Consistency ────────────────────────────────────────────

export interface VisualConsistencyInput {
  perSceneCandidates: PenalizedCandidate[][];
  desiredStyle: VisualStyle;
}

export interface SelectedClip extends PenalizedCandidate {
  consistencyScore: number;  // 0-1, how well it fits the chosen palette
  finalScore: number;
}

export interface VisualConsistencyOutput {
  selectionsBySceneId: Record<number, SelectedClip>;
  rejected: { candidate: PenalizedCandidate; reason: string }[];
}

// ─── Agent 8: Caption Compression ───────────────────────────────────────────

export interface CaptionInput {
  scenes: ScenePlan[];
}

export interface TimedCaption {
  sceneId: number;
  text: string;
  startMs: number;
  endMs: number;
  lineBreaks: string[];      // text pre-split per line (≤22 chars each)
}

export interface CaptionOutput {
  captions: TimedCaption[];
}

// ─── Agent 9: Timing ────────────────────────────────────────────────────────

export interface TimingInput {
  scenes: ScenePlan[];
  narrationDurationSec: number;
}

export interface TimingPlan {
  sceneId: number;
  videoStartMs: number;
  videoEndMs: number;
  transitionInMs: number;
  transitionOutMs: number;
  kenBurnsMs: number;        // full Ken Burns sweep duration
}

export interface TimingOutput {
  perScene: TimingPlan[];
  totalDurationMs: number;
}

// ─── Agent 10: Video Editor ─────────────────────────────────────────────────

export interface EditorInput {
  scenes: ScenePlan[];
  timings: TimingPlan[];
  emotionalArc: EmotionalBeat[];
  baseStyle: VisualStyle;
}

export interface EditDecision {
  sceneId: number;
  zoom: { from: number; to: number };     // 1.0 = no zoom
  pan: { fromX: number; fromY: number; toX: number; toY: number };
  transition: TransitionKind;
  transitionDurationMs: number;
  grade: Grade;
}

export interface EditorOutput {
  decisions: EditDecision[];
  globalGrade: Grade;        // applied to every scene for consistency
}

// ─── Composition plan (BullMQ payload — Agents 1-10 snapshot) ──────────────

export interface CompositionPlanScene {
  plan: ScenePlan;
  clip: SelectedClip;
  caption: TimedCaption;
  timing: TimingPlan;
  edit: EditDecision;
}

export interface CompositionPlan {
  version: "ffmpeg-v2";
  renderJobId: string;
  userId: string;
  topic: string;
  /**
   * Sprint 60 / Sprint A — Render Profile Foundation. Optional + additive: the
   * composer does NOT consume this yet (Sprints B–F will), so absent → today's
   * Legacy behaviour, byte-identical. Resolved from render_context.renderProfile
   * → RENDER_PROFILE_DEFAULT → "legacy" via ./render-profile.
   */
  renderProfile?: RenderProfile;
  scenes: CompositionPlanScene[];
  audio: {
    narrationUrl: string;
    musicUrl: string;
    musicDuckingDb: number;        // legacy static fallback if sidechain unavailable
    /** Sprint 45 — per-scene narration (Audio Timing). When present, the
     * composer places each segment at its scene's MEASURED start offset so the
     * voice tracks the scenes/captions instead of one concatenated read from
     * t=0 (which left a long silent tail). Optional + additive: absent → the
     * legacy single-narrationUrl path runs unchanged (in-flight plans and the
     * /api/generate SSE path keep working byte-identically). */
    narrationSegments?: { sceneId: number; url: string }[];
  };
  output: {
    // Video V1.1: widened from literal 1080×1920 to support 16:9 (1920×1080)
    // and 1:1 (1080×1080). 9:16 remains 1080×1920 (certified default).
    width: number;
    height: number;
    fps: 30;
    durationMs: number;
  };
  globalGrade: Grade;
  // Frozen subset of strategy + script for audit + re-render.
  artifacts: {
    strategy: StrategistOutput;
    script: ScriptOutput;
  };
  /**
   * Optional deterministic branding layer (Ottoflow Video V1). When present,
   * the composer overlays the logo and appends a CTA end card. Brand asset
   * bytes are composited pixel-for-pixel and NEVER sent to a model — same
   * locked-asset discipline as the still-creative compositor. Absent on the
   * stock pipeline → composer behaviour is unchanged.
   */
  branding?: {
    brandId: string;
    brandName?: string | null;
    logoAssetId?: string | null;
    ctaText?: string | null;
    palette?: {
      primary?: string | null;
      secondary?: string | null;
      accent?: string | null;
    } | null;
    /**
     * Visual World V1 finish (Brand Finish Layer). Deterministic look applied
     * identically to every clip; absent → composer falls back to the per-scene
     * enum grade + default caption style (unchanged behaviour).
     */
    grade?: {
      contrast: number;
      saturation: number;
      brightness: number;
    } | null;
    typography?: {
      captionFont: string;
      captionSizePct: number;
      color: string;
      boxOpacity: number;
      case: "sentence" | "upper" | "title";
    } | null;
  };
}

// ─── Ottoflow Video V1 — Video Strategy (Seedance AI-first path) ─────────────
// Reuses the live Topic → Visual Tension → Visual Metaphor engine (the same
// fields the still-creative brief carries) to drive a 4-beat video arc. Stored
// frozen on render_jobs.video_strategy. Seedance generates scenes ONLY; FFmpeg
// (Agents 11/12) remains the composition + branding engine.

export type SceneRole =
  // Certified 4-beat (Video V1, UNCHANGED — keeps render 46bd40cd reproducible).
  | "problem"
  | "tension"
  | "solution"
  | "outcome"
  // Commercial_story 6-beat (Video V1.1, additive — used only in commercial_story mode).
  | "hook"
  | "visualized_pain"
  | "reveal"
  | "proof";

export interface VideoStrategyScene {
  role: SceneRole;
  sceneId: number; // 1-based, aligns with ScenePlan.sceneId
  /** Seedance generation prompt — brand-palette + metaphor seeded, abstract-safe. */
  prompt: string;
  /** Short on-screen caption line for this beat (FFmpeg burns it in). */
  caption: string;
  /** Deterministic seed for reproducible regeneration. */
  seed: number;
  durationSec: number;
  /** Sprint 46 (Scene Relevance) — literal stock-footage search phrase for this
   * shot (subject + action + setting in plain generic words, e.g. "woman
   * working laptop office"). Emitted by the story agent from its structured
   * scene fields, so stock search reflects the scene's SEMANTICS instead of
   * keyword-extracting the cinematic prompt (whose wardrobe/lighting tokens
   * polluted queries — e.g. "coffee cup" → coffee-roasting footage). Optional:
   * absent → the legacy keyword path runs unchanged. */
  searchQuery?: string;
  /** Sprint 49 (Subject-Count Consistency) — deterministic composition fields.
   * The commercial_story arc is written around ONE protagonist, yet stock
   * search sometimes returned couples/groups (prod e009c7fb scene 5: a couple
   * walking, in a single-protagonist story) — breaking immersion. Derived
   * deterministically from the shot plan (no extra AI call): subjectCount 1 =
   * person-led framings (face/over-shoulder/back/silhouette/hands), 0 =
   * environment/detail shots. Stock selection soft-rejects candidates whose
   * page slug names multiple people when subjectCount ≤ 1 and reasonable
   * alternatives exist. All optional/back-compat. */
  subjectCount?: 0 | 1;
  dominantSubject?: string;
  shotType?: string;
  cameraAngle?: string;
  subjectVisibility?: string;
  continuityRole?: string;
}

export interface VideoStrategy {
  video_concept: string;
  visual_tension: string;   // reused from the content creative brief
  visual_metaphor: string;  // reused from the content creative brief
  brand_worldview: string;
  scenes: VideoStrategyScene[];
}

// ─── Agent 11: FFmpeg Composer ──────────────────────────────────────────────

export interface FfmpegComposerInput {
  plan: CompositionPlan;
  workDir: string;
}

export interface CompositionResult {
  localPath: string;         // /tmp/.../out.mp4
  durationSec: number;
  width: number;
  height: number;
  ffmpegStderr: string;      // captured for debugging — also surfaced in QC
}

// ─── Agent 12: Quality Control ──────────────────────────────────────────────

export interface QCIssue {
  agent: AgentName;
  severity: "warn" | "fail";
  code:
    | "low_relevance"
    | "duplicate_clip"
    | "caption_overflow"
    | "caption_unreadable"
    | "timing_drift"
    | "audio_clipping"
    | "color_inconsistency"
    | "ffmpeg_warning";
  message: string;
  sceneId?: number;
}

export interface QCInput {
  plan: CompositionPlan;
  result: CompositionResult;
}

export interface QCReport {
  score: number;             // 0-10
  passed: boolean;           // score >= 8.5
  issues: QCIssue[];
  regenerateRequested: AgentName[]; // empty when passed
}
