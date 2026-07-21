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

/** The composed Creative OS overrides for a render (only produced when fully
 * enabled + a register is supplied). Opaque to Stage 0 — Stage 1 consumes it. */
export interface ComposeOverrides {
  register: string;
  composed: ComposedRegister;
  caption: CaptionPresetOverrides;
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
  env: NodeJS.ProcessEnv = process.env,
): ComposeOverrides | null {
  try {
    const flags = resolveCreativeOsFlags(env);
    if (!flags.enabled || !flags.register || !input.register) return null;
    const composed = composeRegister(input.register, input.frame);
    const caption = activeCaptionOverrides(composed.captionMode, env);
    if (!caption) return null; // the caption capability is also required
    return { register: composed.id, composed, caption };
  } catch {
    return null; // fail-closed: a bridge error can never affect a render
  }
}
