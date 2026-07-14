/**
 * OttoFlow Presentation Engine V4 — core types (Phase 1 foundation).
 *
 * The engine is a PURE, DETERMINISTIC, in-process pipeline of ordered passes that
 * refine a PresentationModel (captions → richer, ASS-ready structure). It runs
 * INSIDE the existing compose step (Modern profiles only), at the existing
 * renderAss / CTA-clip seams. NO workers, NO services, NO orchestration changes.
 *
 * Phase 1 introduces the architecture ONLY — the passes are identity no-ops and
 * nothing consumes the engine yet, so every render (Legacy and Modern) is
 * byte-identical. Later phases replace individual passes (grouping, emphasis,
 * layout, motion, overflow, safe-area, QA) — each feature-gated + fail-safe.
 *
 * Dependency-free (imports only local types) so it stays unit-testable and can be
 * consumed by ass-captions.ts without pulling in the pipeline.
 */
import type { TimedCaption } from "../ffmpeg-pipeline/types";

/** One rendered line = an ordered list of display words. */
export interface PresentationLine {
  words: string[];
}

/**
 * A caption "beat": one on-screen unit spanning [startMs,endMs], grouped into ≤2
 * lines. Passes progressively annotate it (keyword, role, motion, layout).
 */
export interface Beat {
  /** Grouped display lines (1–2), each an ordered word list. */
  lines: PresentationLine[];
  startMs: number;
  endMs: number;
  /** Original caption text (provenance; never re-derived from lines). */
  sourceText: string;
  /** Pass 1 — flat tokenised words for this beat. */
  words?: string[];
  /** Pass 3 — emphasised word index PER LINE (one keyword/line), or null. */
  keywordByLine?: (number | null)[];
  /** Pass 4 — assigned typography role name (e.g. "caption","hero"). */
  role?: string;
  /** Pass 5 — opaque motion spec (compiled to ASS by a later step). */
  motion?: Record<string, unknown>;
  /** Passes 6–7 — layout/fit annotations (fitted size, wrap, clamp). */
  layout?: Record<string, unknown>;
}

/** Tunable engine config (data, not logic). */
export interface PresentationConfig {
  /** Max words per grouped line (Pass 2). Default 3. */
  maxWordsPerLine: number;
  /** Whether the active preset re-groups (Modern smart presets) or preserves the
   * caption's own lineBreaks (Legacy-ish presets). */
  smartGroup: boolean;
  /** Preset base caption font size in px (Pass 4 hierarchy + overflow). Default
   * ~4% of frame height. */
  baseFontPx?: number;
  /** Max emphasis tier eligible for a keyword highlight (Pass 3). Lower = more
   * restrained/premium (only true payload words); higher = more creator-style
   * highlighting. 1 number · 2 pain · 3 transformation · 4 emotion · 5 power-verb ·
   * 6 contrast-pivot · 7 Capitalised · 8 longest-word. Default 8 (highlight every
   * line, legacy). Premium presets pass 5; bold/creator 6. */
  emphasisMaxTier?: number;
}

/** The model threaded through the passes. Passes return a NEW model (pure). */
export interface PresentationModel {
  frame: { width: number; height: number };
  /** Brand accent "#RRGGBB" for keyword emphasis (composer supplies; marigold
   * fallback resolved upstream — never hardcoded here). */
  accentColor?: string;
  /** Active caption preset name (profile-resolved). */
  captionStyle?: string;
  config: PresentationConfig;
  beats: Beat[];
}

/** Input to build the initial model. */
export interface PresentationInput {
  captions: TimedCaption[];
  frame: { width: number; height: number };
  accentColor?: string;
  captionStyle?: string;
  config?: Partial<PresentationConfig>;
}

/** A single deterministic pass: pure model → model. Must NOT throw for control
 * flow; if it can't proceed it should return the input model unchanged (the
 * engine also guards every pass in try/catch as a safety net). */
export interface PresentationPass {
  readonly name: string;
  run(model: PresentationModel): PresentationModel;
}

/** Per-pass execution record (advisory/telemetry; never affects a render). */
export interface PassDiagnostic {
  pass: string;
  ok: boolean;
  note?: string;
  ms: number;
}

/** Advisory QA report (Pass 8; non-blocking). */
export interface PresentationReport {
  scores: Record<string, number>;
  flags: string[];
  pass: boolean;
}

/** Engine output: the refined model + diagnostics + optional advisory QA. */
export interface PresentationResult {
  model: PresentationModel;
  diagnostics: PassDiagnostic[];
  qa?: PresentationReport;
}
