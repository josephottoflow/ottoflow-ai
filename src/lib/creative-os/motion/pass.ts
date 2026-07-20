/**
 * OttoFlow Creative OS — Motion presentation pass (Phase 3).
 *
 * A PresentationPass that populates each beat's `motion` IR from the token-driven
 * Motion Engine, applying the reserved-stillness cadence so some statement beats
 * HOLD and the moving beats own the frame. Like the Typography pass, it is
 * INTENTIONALLY NOT part of DEFAULT_PASSES: it runs only when explicitly composed
 * via `withMotionEngine` behind the Creative OS motion flag, so no existing render
 * (Legacy or the current Modern presets) is affected. Off (default) → byte-identical.
 *
 * Fail-safe: any error returns the input model unchanged — motion can never break
 * a render.
 */
import type { PresentationModel, PresentationPass, Beat } from "../../presentation/types";
import { resolveMotionSig, isHoldBeat } from "./engine";
import { resolveCreativeOsFlags } from "../flags";

/** The effective treatment for a beat at `index`: an ordinary statement becomes a
 * HOLD on the stillness cadence; every other treatment keeps its own signature. */
export function effectiveTreatment(beat: Beat, index: number): string {
  const treatment = beat.treatment ?? "statement";
  return isHoldBeat(index) && treatment === "statement" ? "hold" : treatment;
}

/** The pass. Pure and deterministic; populates `beat.motion`. On any error the
 * input model is returned unchanged. */
export const motionEnginePass: PresentationPass = {
  name: "creative-os-motion",
  run(model: PresentationModel): PresentationModel {
    try {
      return {
        ...model,
        beats: model.beats.map((b, i) => ({
          ...b,
          motion: { ...resolveMotionSig(effectiveTreatment(b, i)) },
        })),
      };
    } catch {
      return model;
    }
  },
};

/**
 * Compose the Motion Engine pass onto a pipeline ONLY when the Creative OS motion
 * flag is enabled. Off (the default) → passes returned unchanged, so nothing is
 * added and behaviour is byte-identical. The single flag-gated activation seam.
 */
export function withMotionEngine(
  passes: readonly PresentationPass[],
  env: NodeJS.ProcessEnv = process.env,
): readonly PresentationPass[] {
  return resolveCreativeOsFlags(env).motion ? [...passes, motionEnginePass] : passes;
}
