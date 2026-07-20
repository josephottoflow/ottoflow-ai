/**
 * OttoFlow Creative OS — QA Engine activation seam (Phase 7).
 *
 * The single, report-only activation point for the QA Engine. It REUSES the Phase
 * 1 QA flag (CREATIVE_OS_QA_MODE=report_only) — no new flag. When that mode is not
 * active (the default), this returns null — no evaluation runs. When active, it
 * runs the advisory evaluation and returns it. The result is ALWAYS advisory
 * (blocking:false); no render path consumes it. There is deliberately no path to a
 * blocking mode — the Phase 1 flag cannot resolve to "blocking".
 */
import { resolveCreativeOsFlags } from "../flags";
import { evaluateQa, type QaCandidate, type QaEvaluation } from "./engine";
import { QA_DEFAULT_THRESHOLD } from "../tokens/qa";

/**
 * Run the advisory QA evaluation IF and only if report-only mode is active;
 * otherwise null. Pure w.r.t. the passed env. Never blocks.
 */
export function activeQaEvaluation(
  candidate: QaCandidate,
  threshold: number = QA_DEFAULT_THRESHOLD,
  env: NodeJS.ProcessEnv = process.env,
): QaEvaluation | null {
  if (resolveCreativeOsFlags(env).qaMode !== "report_only") return null;
  return evaluateQa(candidate, threshold);
}
