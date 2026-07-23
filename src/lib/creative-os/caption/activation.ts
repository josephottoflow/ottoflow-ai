/**
 * OttoFlow Creative OS — Caption Engine activation seam (Phase 5).
 *
 * The single, flag-gated activation point for the Caption Engine. Because a
 * caption personality is a RENDER-LEVEL configuration (which preset a render uses)
 * rather than a per-beat IR field, the activation seam is a resolver — the caption
 * counterpart to the presentation-pass `withXEngine` helpers of Phases 2–4.
 *
 * When the Creative OS caption flag is OFF (the default), this returns null — no
 * override — so the render keeps its existing preset and output is byte-identical.
 * When ON, it returns AnimatedPreset-compatible overrides a Render Profile can
 * merge into a preset. No shipping profile calls this yet.
 */
import { resolveCreativeOsFlags } from "../flags";
import { resolveCaptionPersonality, toPresetOverrides, type CaptionPresetOverrides } from "./engine";

/**
 * Resolve caption preset overrides for a mode IF and only if the caption flag is
 * enabled; otherwise null (no change → byte-identical). Pure w.r.t. the passed env.
 */
export function activeCaptionOverrides(
  mode?: string,
  env: Record<string, string | undefined> = process.env,
): CaptionPresetOverrides | null {
  if (!resolveCreativeOsFlags(env).caption) return null;
  return toPresetOverrides(resolveCaptionPersonality(mode));
}
