/**
 * OttoFlow Creative OS — Typography presentation pass (Phase 2).
 *
 * A PresentationPass that populates each beat's `type` IR from the token-driven
 * Typography Engine. It is the integration seam between the engine and the
 * existing presentation pipeline — but it is INTENTIONALLY NOT part of
 * DEFAULT_PASSES. It runs only when explicitly composed via `withTypographyEngine`
 * behind the Creative OS typography flag, so no existing render (Legacy or the
 * current Modern presets) is affected. With the flag off, the pipeline is
 * unchanged and output is byte-identical.
 *
 * Fail-safe: mirrors the pipeline contract — any error returns the input model
 * unchanged so typography can never break a render.
 */
import type { Beat, PresentationModel, PresentationPass } from "../../presentation/types";
import { estimateWidthPx } from "../../presentation/grouping";
import { fitTypeSpec } from "./engine";
import { resolveCreativeOsFlags } from "../flags";
import type { TypographyRole } from "../tokens/typography";

/**
 * Map a beat to a canonical typographic role, deterministically, from its
 * narrative treatment, prior role hint, and word count. Short/hook beats command
 * the frame (display); stats read as figures (numeral); the default is caption
 * (spoken word, read in motion).
 */
export function roleForBeat(beat: Beat): TypographyRole {
  const total = beat.lines.reduce((a, l) => a + l.words.length, 0);
  const treatment = beat.treatment;
  if (treatment === "stat") return "numeral";
  if (beat.role === "hero" || treatment === "hook" || total <= 2) return "display";
  if (beat.role === "headline" || treatment === "cta") return "lead";
  if (treatment === "question" || treatment === "turn") return "subhead";
  return "caption";
}

/**
 * The pass. Pure and deterministic; populates `beat.type` (overflow-fitted) via
 * the engine. On any error the input model is returned unchanged.
 */
export const typographyEnginePass: PresentationPass = {
  name: "creative-os-typography",
  run(model: PresentationModel): PresentationModel {
    try {
      return {
        ...model,
        beats: model.beats.map((b) => {
          const role = roleForBeat(b);
          const lines = b.lines.map((l) => l.words);
          const type = fitTypeSpec(role, lines, model.frame, estimateWidthPx);
          return { ...b, type };
        }),
      };
    } catch {
      return model;
    }
  },
};

/**
 * Compose the Typography Engine pass onto a pipeline ONLY when the Creative OS
 * typography flag is enabled. Off (the default) → the passes are returned
 * unchanged, so nothing is added and behaviour is byte-identical. This is the
 * single, flag-gated activation seam for Phase 2.
 */
export function withTypographyEngine(
  passes: readonly PresentationPass[],
  env: Record<string, string | undefined> = process.env,
): readonly PresentationPass[] {
  return resolveCreativeOsFlags(env).typography ? [...passes, typographyEnginePass] : passes;
}
