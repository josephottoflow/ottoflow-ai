/**
 * OttoFlow Creative OS — feature-flag scaffolding (Phase 1 safety infrastructure).
 *
 * Server-only, lazy (read on use), FAIL-CLOSED: anything but the exact expected
 * string leaves the capability OFF. Mirrors the proven `video/flags.ts` pattern.
 *
 * NOTHING in the render path consumes these flags yet. They exist so that later
 * implementation cycles (Typography, Motion, Layout, Captions, Registers, QA) can
 * gate their behaviour WITHOUT editing this module. With every flag unset — the
 * production default — behaviour is unchanged and Legacy output is byte-identical.
 *
 * Rollback: unset the env var(s). Every capability returns to OFF (Legacy). No
 * deploy or code change is required to disable.
 *
 * Design notes:
 *   - The pure `resolveCreativeOsFlags(env)` holds ALL logic and takes an env map,
 *     so it is trivially unit-testable without mutating `process.env`.
 *   - The `is*()` helpers are thin wrappers that read the live `process.env`.
 *   - `qaMode` only ever resolves to "off" or "report_only". A blocking QA gate
 *     does not exist in code yet, so "blocking" (or any stray value) can never be
 *     produced here — enforcement can never precede its implementation.
 */

/** QA execution mode. "report_only" = advisory logging, never blocking. */
export type QaMode = "off" | "report_only";

/** Immutable snapshot of the Creative OS flags for a given environment. */
export interface CreativeOsFlags {
  /** Master gate for the entire Creative OS layer. */
  enabled: boolean;
  /** QA mode. Never "blocking" — no blocking gate exists yet (fail-closed). */
  qaMode: QaMode;
  /**
   * Typography Engine capability (Phase 2). When true, the token-driven
   * Typography Engine MAY be composed into a presentation pipeline. This flag is
   * a capability toggle only — it does not, by itself, change any render: the
   * engine is consumed solely through the Render Profile mechanism (a later
   * cycle), and no shipping profile consumes it yet. With this off (the default),
   * behaviour is byte-identical.
   */
  typography: boolean;
}

/**
 * Resolve the Creative OS flags from an environment map. Pure and total — never
 * throws, never reads globals, always returns a fully-populated snapshot. This is
 * the single source of truth; the `is*()` helpers below delegate to it.
 *
 * Fail-closed rules:
 *   - `enabled` is true ONLY for the exact string "true".
 *   - `qaMode` is "report_only" ONLY when the master gate is on AND
 *     CREATIVE_OS_QA_MODE is exactly "report_only". Everything else → "off".
 */
export function resolveCreativeOsFlags(
  env: NodeJS.ProcessEnv = process.env,
): CreativeOsFlags {
  const enabled = env.CREATIVE_OS_ENABLED === "true";
  const qaMode: QaMode =
    enabled && env.CREATIVE_OS_QA_MODE === "report_only" ? "report_only" : "off";
  const typography = enabled && env.CREATIVE_OS_TYPOGRAPHY === "true";
  return { enabled, qaMode, typography };
}

/** True only when the Creative OS master gate is explicitly enabled. */
export function isCreativeOsEnabled(): boolean {
  return resolveCreativeOsFlags().enabled;
}

/** The active QA mode ("off" | "report_only"). */
export function qaMode(): QaMode {
  return resolveCreativeOsFlags().qaMode;
}

/** True only when QA advisory report-only mode is active (never blocking). */
export function isQaReportOnly(): boolean {
  return resolveCreativeOsFlags().qaMode === "report_only";
}

/** True only when the Typography Engine capability is enabled (requires the
 * master gate). A capability toggle only — activation is via a Render Profile. */
export function isTypographyEngineEnabled(): boolean {
  return resolveCreativeOsFlags().typography;
}
