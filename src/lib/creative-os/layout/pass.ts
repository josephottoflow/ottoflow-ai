/**
 * OttoFlow Creative OS — Layout presentation pass (Phase 4).
 *
 * A PresentationPass that annotates each beat's `layout` IR with the token-driven
 * safe-zone geometry and a density check, PRESERVING any existing layout keys
 * (archetype, align, fontMult, …). Like the Typography/Motion passes it is
 * INTENTIONALLY NOT part of DEFAULT_PASSES: it runs only when explicitly composed
 * via `withLayoutEngine` behind the Creative OS layout flag, so no existing render
 * (Legacy or the current Modern presets) is affected. Off (default) → byte-identical.
 *
 * Fail-safe: any error returns the input model unchanged.
 */
import type { PresentationModel, PresentationPass } from "../../presentation/types";
import { resolveSafeInsets, withinDensity } from "./engine";
import { resolveCreativeOsFlags } from "../flags";

/** The pass. Pure and deterministic; enriches `beat.layout` with `safe` insets
 * and a `densityOk` flag (element proxy = number of lines). Existing layout keys
 * are preserved. On any error the input model is returned unchanged. */
export const layoutEnginePass: PresentationPass = {
  name: "creative-os-layout",
  run(model: PresentationModel): PresentationModel {
    try {
      const safe = resolveSafeInsets(model.frame);
      return {
        ...model,
        beats: model.beats.map((b) => ({
          ...b,
          layout: {
            ...(b.layout ?? {}),
            safe,
            densityOk: withinDensity(b.lines.length),
          },
        })),
      };
    } catch {
      return model;
    }
  },
};

/**
 * Compose the Layout Engine pass onto a pipeline ONLY when the Creative OS layout
 * flag is enabled. Off (the default) → passes returned unchanged, so nothing is
 * added and behaviour is byte-identical. The single flag-gated activation seam.
 */
export function withLayoutEngine(
  passes: readonly PresentationPass[],
  env: Record<string, string | undefined> = process.env,
): readonly PresentationPass[] {
  return resolveCreativeOsFlags(env).layout ? [...passes, layoutEnginePass] : passes;
}
