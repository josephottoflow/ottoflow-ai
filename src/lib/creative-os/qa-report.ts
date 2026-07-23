/**
 * OttoFlow Creative OS — QA report-only scaffolding (Phase 1 safety infrastructure).
 *
 * This is the PLUMBING for advisory QA, not the QA scoring itself. The real
 * ten-dimension evaluation is the QA Engine, built in a later cycle (Readiness
 * Review Phase 7). Here we establish the report-only pathway so that, when the
 * scoring lands, it can be run in a mode that LOGS and never BLOCKS — and prove
 * that mode is:
 *
 *   - OFF by default (gated behind CREATIVE_OS_QA_MODE=report_only + master gate),
 *   - non-blocking ALWAYS (`blocking` is the literal `false`),
 *   - fail-safe (never throws; a QA error can never break a render),
 *   - inert in the render path (nothing imports this yet).
 *
 * Rollback: unset CREATIVE_OS_QA_MODE (or the master gate). The runner returns
 * null and does nothing.
 */
import { resolveCreativeOsFlags } from "./flags";

/** One evaluated QA dimension. Populated by the QA Engine in a later cycle. */
export interface AdvisoryDimension {
  name: string;
  /** 0..1 quality score, or null when not yet scored. */
  score: number | null;
  /** Hard-gate result, or null when not yet evaluated. */
  gatePass: boolean | null;
}

/** Minimal, extensible context a report is built from. */
export interface AdvisoryQaInput {
  /** Active render profile / register id (context only). */
  profile: string;
  frame?: { width: number; height: number };
  /** Extension point for the future QA Engine; ignored today. */
  meta?: Record<string, unknown>;
}

/** An advisory QA report. `blocking` is the literal `false` by type — a
 * report-only report can NEVER express a blocking verdict. */
export interface AdvisoryQaReport {
  mode: "report_only";
  blocking: false;
  profile: string;
  /** Empty until the QA Engine (later cycle) populates it. */
  dimensions: AdvisoryDimension[];
  note: string;
}

/** Sink for advisory reports (telemetry/logging). Kept injectable so this module
 * has no hard dependency on the observability/Sentry layer. */
export type QaSink = (report: AdvisoryQaReport) => void;

const SCAFFOLD_NOTE =
  "advisory scaffold — QA scoring not implemented yet (report-only, non-blocking)";

/**
 * Build an advisory report. Pure and deterministic (no clock, no I/O). Returns an
 * empty-dimensions scaffold today; the QA Engine will populate `dimensions` in a
 * later cycle. `blocking` is always false.
 */
export function buildAdvisoryReport(input: AdvisoryQaInput): AdvisoryQaReport {
  return {
    mode: "report_only",
    blocking: false,
    profile: input.profile,
    dimensions: [],
    note: SCAFFOLD_NOTE,
  };
}

/**
 * Run advisory QA IF and only if report-only mode is active. Returns the report
 * (also handed to `sink`) when active, or null when inactive.
 *
 * Guarantees, all covered by tests:
 *   - Inactive unless master gate + CREATIVE_OS_QA_MODE=report_only (→ null).
 *   - Never throws — a failure building the report or in the sink is swallowed;
 *     QA can never break a render.
 *   - Never blocks — the returned report's `blocking` is always false, and this
 *     function has no ability to halt anything (callers only observe/log).
 */
export function maybeRunAdvisoryQa(
  input: AdvisoryQaInput,
  sink?: QaSink,
  env: NodeJS.ProcessEnv = process.env,
): AdvisoryQaReport | null {
  if (resolveCreativeOsFlags(env).qaMode !== "report_only") return null;
  let report: AdvisoryQaReport;
  try {
    report = buildAdvisoryReport(input);
  } catch {
    return null; // fail-safe: an advisory failure is never allowed to surface
  }
  try {
    sink?.(report);
  } catch {
    /* logging must never break a render */
  }
  return report;
}
