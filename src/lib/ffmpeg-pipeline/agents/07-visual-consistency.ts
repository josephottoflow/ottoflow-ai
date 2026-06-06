/**
 * Agent 7: Visual Consistency + final per-scene selection.
 *
 * This is where ONE clip per scene is chosen. The constraint: the four chosen
 * clips should feel like they belong in the same video — similar production
 * quality, similar source mix, no jarring tonal jump.
 *
 * Algorithm (greedy with consistency reward):
 *   1. finalScore_base = clamp(score - diversityPenalty, 0, 10) per candidate.
 *   2. Pick scene 1's winner = highest finalScore_base.
 *   3. For each subsequent scene, reward candidates that match the running
 *      "video signature" (dominant source + average quality band + framing),
 *      then pick the highest finalScore (base + consistency reward).
 *   4. Reject candidates whose quality is far below the running average — a
 *      480p clip among 1080p clips reads as broken.
 *
 * No LLM call — this is deterministic ranking. Vision-level palette matching
 * is a Phase-2 upgrade noted in ADR-002 open questions.
 */
import type {
  AgentContext,
  PenalizedCandidate,
  SelectedClip,
  VisualConsistencyInput,
  VisualConsistencyOutput,
} from "../types";

const CONSISTENCY_REWARD = 1.5; // max points added for matching the signature
const QUALITY_FLOOR_DELTA = 0.35; // reject if quality < runningAvg - this

interface Signature {
  dominantSource: string;
  avgQuality: number;
  avgFraming: number;
  count: number;
}

function baseScore(c: PenalizedCandidate): number {
  return Math.max(0, Math.min(10, c.score - c.diversityPenalty));
}

function consistencyReward(c: PenalizedCandidate, sig: Signature): number {
  if (sig.count === 0) return 0;
  let reward = 0;
  // Same source family → smoother visual grammar.
  if (c.source === sig.dominantSource) reward += CONSISTENCY_REWARD * 0.4;
  // Quality close to the running average.
  reward += CONSISTENCY_REWARD * 0.3 * (1 - Math.abs(c.quality - sig.avgQuality));
  // Framing close to the running average.
  reward += CONSISTENCY_REWARD * 0.3 * (1 - Math.abs(c.framing - sig.avgFraming));
  return Math.max(0, reward);
}

function updateSignature(sig: Signature, picked: SelectedClip): Signature {
  const count = sig.count + 1;
  return {
    dominantSource: picked.source, // simplistic: last pick biases dominance
    avgQuality: (sig.avgQuality * sig.count + picked.quality) / count,
    avgFraming: (sig.avgFraming * sig.count + picked.framing) / count,
    count,
  };
}

export async function runVisualConsistency(
  input: VisualConsistencyInput,
  ctx: AgentContext,
): Promise<VisualConsistencyOutput> {
  ctx.log("agent.visualConsistency.start", {
    scenes: input.perSceneCandidates.length,
  });

  const selectionsBySceneId: Record<number, SelectedClip> = {};
  const rejected: { candidate: PenalizedCandidate; reason: string }[] = [];

  let sig: Signature = {
    dominantSource: "",
    avgQuality: 0,
    avgFraming: 0,
    count: 0,
  };

  // perSceneCandidates is ordered by sceneId (scene 1 at index 0), so the
  // sceneId is simply the loop index + 1 — no fragile reverse-lookup needed.
  for (let sceneIdx = 0; sceneIdx < input.perSceneCandidates.length; sceneIdx++) {
    const candidates = input.perSceneCandidates[sceneIdx];
    const sceneId = sceneIdx + 1;
    if (candidates.length === 0) {
      // No candidates for this scene — caller (orchestrator) handles the
      // empty-scene error; we skip so the rest still gets selected.
      continue;
    }

    // Quality floor relative to the running signature.
    const eligible = candidates.filter((c) => {
      if (sig.count === 0) return true;
      if (c.quality < sig.avgQuality - QUALITY_FLOOR_DELTA) {
        rejected.push({
          candidate: c,
          reason: `quality ${c.quality.toFixed(2)} below running avg ${sig.avgQuality.toFixed(2)} - ${QUALITY_FLOOR_DELTA}`,
        });
        return false;
      }
      return true;
    });
    const pool = eligible.length > 0 ? eligible : candidates;

    // Rank by base + consistency reward.
    let best: SelectedClip | null = null;
    for (const c of pool) {
      const consistency = consistencyReward(c, sig);
      const finalScore = baseScore(c) + consistency;
      const sel: SelectedClip = {
        ...c,
        consistencyScore: sig.count === 0 ? 1 : consistency / CONSISTENCY_REWARD,
        finalScore,
      };
      if (!best || sel.finalScore > best.finalScore) best = sel;
    }
    if (!best) continue;

    selectionsBySceneId[sceneId] = best;
    sig = updateSignature(sig, best);
  }

  ctx.log("agent.visualConsistency.done", {
    selected: Object.keys(selectionsBySceneId).length,
    rejected: rejected.length,
  });

  return { selectionsBySceneId, rejected };
}
