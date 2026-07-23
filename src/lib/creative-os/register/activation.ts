/**
 * OttoFlow Creative OS — Register Engine activation seam (Phase 6).
 *
 * The single, flag-gated activation point for the Register Engine. When the
 * Creative OS register flag is OFF (the default), this returns null — no composed
 * register — so a render keeps its existing behaviour and output is byte-identical.
 * When ON, it returns the composed register bundle a Render Profile can apply. No
 * shipping profile calls this yet.
 */
import { resolveCreativeOsFlags } from "../flags";
import { composeRegister, type ComposedRegister } from "./engine";
import type { Frame } from "../layout/engine";

/**
 * Resolve a composed register IF and only if the register flag is enabled;
 * otherwise null (no change → byte-identical). Pure w.r.t. the passed env.
 */
export function activeRegister(
  id: string,
  frame: Frame,
  env: NodeJS.ProcessEnv = process.env,
): ComposedRegister | null {
  if (!resolveCreativeOsFlags(env).register) return null;
  return composeRegister(id, frame);
}
