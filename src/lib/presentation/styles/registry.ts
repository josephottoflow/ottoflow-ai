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
import { EDITORIAL } from "./editorial";
import { BROADCAST } from "./broadcast";
import { DOCUMENTARY } from "./documentary";
import { SIGNATURE } from "./signature";
import { MINIMAL } from "./minimal";
import { CINEMATIC } from "./cinematic";
import { PRECISION } from "./precision";
import { MOMENTUM } from "./momentum";
import { PULSE } from "./pulse";
import { CUSTOM } from "./custom";

export const STYLE_FAMILIES: Record<string, StyleFamily> = {
  [PREMIUM.id]: PREMIUM,
  [IMPACT.id]: IMPACT,
  [EDITORIAL.id]: EDITORIAL,
  [BROADCAST.id]: BROADCAST,
  [DOCUMENTARY.id]: DOCUMENTARY,
  [SIGNATURE.id]: SIGNATURE,
  [MINIMAL.id]: MINIMAL,
  [CINEMATIC.id]: CINEMATIC,
  [PRECISION.id]: PRECISION,
  [MOMENTUM.id]: MOMENTUM,
  [PULSE.id]: PULSE,
  [CUSTOM.id]: CUSTOM,
};

/** The registry-derived allowlist of philosophy ids (COS migration M1). The ONE
 * source of truth for "which Creative OS styles exist", consumed by the render-
 * profile allowlist + the API validator so the three never drift. */
export const PHILOSOPHY_IDS: readonly string[] = Object.keys(STYLE_FAMILIES);

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
