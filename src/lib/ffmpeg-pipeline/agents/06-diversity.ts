/**
 * Agent 6: Diversity.
 *
 * Reads the user's recent asset_history (last `lookbackJobs` rows) and applies
 * a penalty to any candidate whose (source, source_id) was used recently. The
 * penalty is SOFT — subtracted from the score, never a hard reject — so a
 * highly-relevant clip can still win if nothing better exists.
 *
 * Penalty curve: a clip used in the most recent job gets the full penalty;
 * the penalty decays linearly to 0 at the lookback horizon. Clips used
 * multiple times stack (capped).
 *
 * Operates across ALL scenes at once so asset_history is fetched ONE time per
 * video, not once per scene.
 */
import { createAdminClient } from "@/lib/supabase";
import { captureFallback } from "@/lib/observability";
import type {
  AgentContext,
  AnalyzedCandidate,
  DiversityInput,
  DiversityOutput,
  PenalizedCandidate,
} from "../types";

const MAX_PENALTY = 4.0; // points subtracted from a 0-10 score at worst

interface HistoryRow {
  source: string;
  source_id: string;
  used_at: string;
}

/**
 * Fetch the most recent `limit` asset_history rows for this user, newest
 * first. Returns [] on any error — diversity is an optimisation, never a
 * blocker.
 */
async function fetchHistory(
  userId: string,
  limit: number,
  ctx: AgentContext,
): Promise<HistoryRow[]> {
  try {
    const admin = createAdminClient();
    // We approximate "last N jobs" with "last N*4 asset rows" (≈4 scenes/job).
    const { data, error } = await admin
      .from("asset_history")
      .select("source, source_id, used_at")
      .eq("user_id", userId)
      .order("used_at", { ascending: false })
      .limit(limit * 4);
    if (error) {
      ctx.log("agent.diversity.history_query_error", { error: error.message });
      return [];
    }
    return (data ?? []) as HistoryRow[];
  } catch (err) {
    captureFallback("agent.diversity.history_failed", err, { userId });
    return [];
  }
}

/**
 * Build a penalty map keyed by `source:source_id`. Recency-weighted:
 * index 0 (most recent) → MAX_PENALTY, decaying to 0 at the end of the list.
 * Repeated uses accumulate (capped at MAX_PENALTY).
 */
function buildPenaltyMap(history: HistoryRow[]): Map<string, number> {
  const map = new Map<string, number>();
  const n = history.length;
  if (n === 0) return map;
  history.forEach((row, i) => {
    const recency = 1 - i / n;                 // 1.0 newest → ~0 oldest
    const contribution = MAX_PENALTY * recency;
    const key = `${row.source}:${row.source_id}`;
    map.set(key, Math.min(MAX_PENALTY, (map.get(key) ?? 0) + contribution));
  });
  return map;
}

function penalize(
  candidates: AnalyzedCandidate[],
  penaltyMap: Map<string, number>,
): PenalizedCandidate[] {
  return candidates.map((c) => {
    const pen = penaltyMap.get(`${c.source}:${c.sourceId}`) ?? 0;
    return { ...c, diversityPenalty: pen };
  });
}

export async function runDiversity(
  input: DiversityInput,
  ctx: AgentContext,
): Promise<DiversityOutput> {
  ctx.log("agent.diversity.start", {
    scenes: input.perSceneCandidates.length,
    lookbackJobs: input.lookbackJobs,
  });

  const history = await fetchHistory(input.userId, input.lookbackJobs, ctx);
  const penaltyMap = buildPenaltyMap(history);

  const perScenePenalized = input.perSceneCandidates.map((c) =>
    penalize(c, penaltyMap),
  );

  const penalizedCount = perScenePenalized
    .flat()
    .filter((c) => c.diversityPenalty > 0).length;

  ctx.log("agent.diversity.done", {
    historyRows: history.length,
    penalizedCandidates: penalizedCount,
  });

  return { perScenePenalized };
}
