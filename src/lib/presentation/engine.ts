/**
 * Presentation Engine V4 — orchestrator (Phase 1 foundation).
 *
 * Runs the ordered passes over an initial model. FAIL-SAFE by construction: every
 * pass is guarded; a throwing pass is recorded and SKIPPED (the pre-pass model is
 * kept) so the engine NEVER throws and can always hand back a usable model. This
 * mirrors the renderAss try/catch → Legacy safety already in production.
 *
 * Phase 1: passes are identity no-ops and NOTHING consumes the engine, so output
 * is byte-identical for every profile. Later phases swap in real passes; the
 * engine contract stays the same.
 */
import type {
  Beat,
  PresentationInput,
  PresentationModel,
  PresentationPass,
  PassDiagnostic,
  PresentationResult,
} from "./types";
import { DEFAULT_PASSES } from "./passes";

/**
 * Build the initial model from captions. Each caption becomes one beat using its
 * existing pre-computed lineBreaks (folded to ≤2 lines), preserving today's
 * grouping until Pass 2 replaces it. Pure; no timing/emphasis decisions here.
 */
export function initModel(input: PresentationInput): PresentationModel {
  const beats: Beat[] = input.captions.map((c) => {
    const raw = c.lineBreaks && c.lineBreaks.length > 0 ? c.lineBreaks : [c.text];
    const folded = raw.length <= 2 ? raw : [raw[0], raw.slice(1).join(" ")];
    return {
      lines: folded.map((l) => ({ words: l.split(/\s+/).filter(Boolean) })),
      startMs: c.startMs,
      endMs: c.endMs,
      sourceText: c.text,
      keyword: null,
    };
  });
  return {
    frame: input.frame,
    accentColor: input.accentColor,
    captionStyle: input.captionStyle,
    beats,
  };
}

/**
 * Run the engine. Returns the refined model + per-pass diagnostics (advisory).
 * `passes` defaults to the canonical 8-pass pipeline; injectable for testing.
 */
export function runPresentationEngine(
  input: PresentationInput,
  passes: readonly PresentationPass[] = DEFAULT_PASSES,
): PresentationResult {
  let model = initModel(input);
  const diagnostics: PassDiagnostic[] = [];
  for (const p of passes) {
    const t0 = Date.now();
    try {
      const next = p.run(model);
      // Defensive: a pass must return a model; ignore a nullish result.
      if (next && Array.isArray(next.beats)) model = next;
      diagnostics.push({ pass: p.name, ok: true, ms: Date.now() - t0 });
    } catch (err) {
      // Fail-safe: keep the pre-pass model and continue. Never throw.
      diagnostics.push({
        pass: p.name,
        ok: false,
        note: (err instanceof Error ? err.message : String(err)).slice(0, 160),
        ms: Date.now() - t0,
      });
    }
  }
  return { model, diagnostics };
}
