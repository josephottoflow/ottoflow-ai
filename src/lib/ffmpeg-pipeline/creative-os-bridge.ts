/**
 * Creative OS activation bridge (Stage 0 — dormant).
 *
 * The single connection point between the certified Creative OS engines and the
 * render pipeline. It is PURE, FAIL-CLOSED, and SIDE-EFFECT FREE: it returns null
 * unless the Creative OS flags are enabled AND a register id is supplied — which
 * never happens in production today (all flags off, and Stage 0 threads no
 * register). While it returns null (the only production state), the composer's
 * render call is byte-identical to before.
 *
 * Stage 0 establishes only the dormant seam. Stage 1 (separately approved) will
 * thread a register id from the job and define how these overrides merge into the
 * caption preset + presentation passes. Nothing here modifies a certified engine;
 * they are imported and called, never changed.
 */
import { resolveCreativeOsFlags } from "../creative-os/flags";
import { composeRegister, type ComposedRegister } from "../creative-os/register/engine";
import { activeCaptionOverrides } from "../creative-os/caption/activation";
import type { CaptionPresetOverrides } from "../creative-os/caption/engine";
import type { Frame } from "../creative-os/layout/engine";
import type { CoreCaptionPreset } from "./ass-captions";

/**
 * Register → render-profile patch (Stage 1). Maps an ACTIVATED register to the
 * CERTIFIED caption preset it renders through, so activation reuses existing,
 * byte-tested Modern rendering — it introduces no new caption behaviour and cannot
 * change Legacy or the directly-selected Modern presets.
 *
 * Stage 1 defines ONLY "founder" (→ the certified premium "corporate" preset). A
 * register with no entry here is not activatable — this is how "only Founder is
 * available" is enforced at the boundary. Future stages ADD entries; they never
 * bypass this map.
 */
const REGISTER_PROFILE_PATCH: Partial<Record<string, { captionStyle: CoreCaptionPreset }>> = {
  founder: { captionStyle: "corporate" },
};

/** The caption-profile shape the composer passes to renderAss (the merge target). */
export interface CaptionProfile {
  captionEngine?: "static" | "animated";
  /** A core preset (classic/bold_creator/minimal/corporate) OR a Creative OS
   * philosophy id (COS migration M1). renderAss resolves a philosophy id via the
   * registry before falling back to the preset table. */
  captionStyle?: CoreCaptionPreset | string;
  accentColor?: string | null;
  /** Animated-engine selector (Motion Typography Engine). Passed through untouched
   * by applyCaptionProfile — the bridge patches engine/preset only, never the
   * renderer selection. (COS migration, Gate I-2.) */
  presentationEngine?: "motion" | "classic-modern";
}

/** The composed Creative OS overrides for a render (only produced when fully
 * enabled + an ACTIVATABLE register is supplied). Consumed by applyCaptionProfile. */
export interface ComposeOverrides {
  register: string;
  composed: ComposedRegister;
  caption: CaptionPresetOverrides;
  /** How to patch the caption profile: engine + the certified preset to render through. */
  profilePatch: { captionEngine: "animated"; captionStyle: CoreCaptionPreset };
}

/** Input to the bridge: an optional register id and the render frame. */
export interface ComposeInput {
  register?: string;
  frame: Frame;
}

/**
 * Resolve the Creative OS overrides for a render, or null. Returns null unless the
 * master gate, the register capability, AND the caption capability are all on AND
 * a register id is supplied. Pure w.r.t. the passed env; any error → null (Legacy).
 *
 * In Stage 0 this is always null in production (flags off, no register threaded),
 * so the caller's render is byte-identical.
 */
export function resolveComposeOverrides(
  input: ComposeInput,
  env: Record<string, string | undefined> = process.env,
): ComposeOverrides | null {
  try {
    const flags = resolveCreativeOsFlags(env);
    if (!flags.enabled || !flags.register || !input.register) return null;
    const patch = REGISTER_PROFILE_PATCH[input.register];
    if (!patch) return null; // register not activatable (Stage 1: only "founder")
    const composed = composeRegister(input.register, input.frame);
    const caption = activeCaptionOverrides(composed.captionMode, env);
    if (!caption) return null; // the caption capability is also required
    return {
      register: composed.id,
      composed,
      caption,
      profilePatch: { captionEngine: "animated", captionStyle: patch.captionStyle },
    };
  } catch {
    return null; // fail-closed: a bridge error can never affect a render
  }
}

/**
 * Apply the bridge overrides to a caption profile — the merge point. Pure: with
 * `overrides` null (the production default) it returns the base profile UNCHANGED
 * (byte-identical); otherwise it swaps in the register's engine + certified preset,
 * keeping the caller's brand accent. This is the ONLY place the bridge result
 * touches the render profile.
 */
export function applyCaptionProfile(
  base: CaptionProfile,
  overrides: ComposeOverrides | null,
): CaptionProfile {
  if (!overrides) return base;
  return {
    ...base,
    captionEngine: overrides.profilePatch.captionEngine,
    captionStyle: overrides.profilePatch.captionStyle,
  };
}
