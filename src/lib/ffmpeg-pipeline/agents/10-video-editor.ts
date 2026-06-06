/**
 * Agent 10: Video Editor.
 *
 * Acts as the editor making per-scene motion + transition + grade decisions.
 * The goal is variety WITHIN a coherent video:
 *   - Ken Burns direction + magnitude alternate per scene so the video never
 *     reads as "every clip slowly zooms in the same way".
 *   - Transition kind is chosen by the OUTGOING scene's emotion (urgent →
 *     hard cut / wipe, calm → dissolve, etc.).
 *   - ONE global colour grade is applied to every scene for consistency
 *     (per ADR-002 §Quality strategy point 6).
 *
 * Deterministic given the inputs + a per-render seed (so two runs of the same
 * plan differ, but a single plan is reproducible within a job for QC regen).
 *
 * No LLM — editorial heuristics.
 */
import type {
  AgentContext,
  EditorInput,
  EditorOutput,
  EditDecision,
  Emotion,
  TransitionKind,
  VisualStyle,
  Grade,
} from "../types";

// Map base visual style → global grade.
function gradeForStyle(style: VisualStyle): Grade {
  switch (style) {
    case "cinematic":
    case "moody":
      return "cinematic";
    case "vibrant":
    case "ugc":
      return "punchy";
    case "documentary":
    case "minimal":
      return "natural";
    default:
      return "warm";
  }
}

// Map an emotion → the transition that should FOLLOW a scene of that emotion.
function transitionForEmotion(emotion: Emotion, isLast: boolean): TransitionKind {
  if (isLast) return "cut"; // last scene has no outgoing transition
  switch (emotion) {
    case "urgent":
    case "energetic":
      return "wiperight";
    case "anxious":
      return "fadeblack";
    case "calm":
    case "hopeful":
      return "dissolve";
    case "confident":
    case "curious":
    default:
      return "fade";
  }
}

/**
 * Alternate Ken Burns direction per scene index. Even scenes push in,
 * odd scenes pull out; pan origin alternates across a small set of anchors
 * so successive scenes don't share the same motion vector.
 */
function kenBurns(idx: number): EditDecision["zoom"] & {
  pan: EditDecision["pan"];
} {
  const pushIn = idx % 2 === 0;
  const zoom = pushIn
    ? { from: 1.0, to: 1.12 }
    : { from: 1.12, to: 1.0 };

  // Anchor cycle: center, slight-up, slight-left, slight-right.
  const anchors: EditDecision["pan"][] = [
    { fromX: 0.5,  fromY: 0.5,  toX: 0.5,  toY: 0.5  },
    { fromX: 0.5,  fromY: 0.45, toX: 0.5,  toY: 0.55 },
    { fromX: 0.45, fromY: 0.5,  toX: 0.55, toY: 0.5  },
    { fromX: 0.55, fromY: 0.5,  toX: 0.45, toY: 0.5  },
  ];
  return { ...zoom, pan: anchors[idx % anchors.length] };
}

export async function runVideoEditor(
  input: EditorInput,
  ctx: AgentContext,
): Promise<EditorOutput> {
  ctx.log("agent.videoEditor.start", { scenes: input.scenes.length });

  const globalGrade = gradeForStyle(input.baseStyle);

  const decisions: EditDecision[] = input.scenes.map((scene, i) => {
    const isLast = i === input.scenes.length - 1;
    const kb = kenBurns(i);
    const timing = input.timings.find((t) => t.sceneId === scene.sceneId);
    const transitionDurationMs =
      isLast ? 0 : timing?.transitionOutMs ?? 400;
    return {
      sceneId: scene.sceneId,
      zoom: { from: kb.from, to: kb.to },
      pan: kb.pan,
      transition: transitionForEmotion(scene.emotion, isLast),
      transitionDurationMs,
      grade: globalGrade,
    };
  });

  ctx.log("agent.videoEditor.done", {
    grade: globalGrade,
    transitions: decisions.map((d) => d.transition),
  });

  return { decisions, globalGrade };
}
