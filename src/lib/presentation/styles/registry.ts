/**
 * Style registry — the ONLY place engines learn which OttoFlow styles exist.
 * Adding a style = author its config file + add one line here. No engine edits.
 *
 * Styles are OttoFlow-native presentation PHILOSOPHIES (Premium, Impact, …), never
 * named after external brands/creators — those are research references only, their
 * identity discarded. The product exposes only these OttoFlow names.
 */
import type { StyleFamily } from "./types";
import { PREMIUM } from "./premium";
import { IMPACT } from "./impact";

export const STYLE_FAMILIES: Record<string, StyleFamily> = {
  [PREMIUM.id]: PREMIUM,
  [IMPACT.id]: IMPACT,
};

/** Resolve a style by id; null when unknown (caller falls back to preset path). */
export function getStyleFamily(id?: string | null): StyleFamily | null {
  return id ? STYLE_FAMILIES[id] ?? null : null;
}

/** Back-compat: map a caption preset name → OttoFlow style id (Modern only).
 * corporate → Premium, bold_creator → Impact. Others → null (classic/minimal keep
 * the legacy preset path; Legacy stays untouched). */
export function styleIdForPreset(preset?: string | null): string | null {
  if (preset === "corporate") return PREMIUM.id;
  if (preset === "bold_creator") return IMPACT.id;
  return null;
}
