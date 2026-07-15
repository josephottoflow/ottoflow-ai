/**
 * Style registry — the ONLY place engines learn which families exist. Adding a
 * family = import it + add one line here (plus its config file). No engine edits.
 */
import type { StyleFamily } from "./types";
import { APPLE } from "./apple";
import { HORMOZI } from "./hormozi";

export const STYLE_FAMILIES: Record<string, StyleFamily> = {
  [APPLE.id]: APPLE,
  [HORMOZI.id]: HORMOZI,
};

/** Resolve a style by id; null when unknown (caller falls back to preset path). */
export function getStyleFamily(id?: string | null): StyleFamily | null {
  return id ? STYLE_FAMILIES[id] ?? null : null;
}

/** Back-compat: map a caption preset name → style-family id (Modern only).
 * corporate → Luxury·Apple, bold_creator → Viral·Hormozi. Others → null (the
 * classic/minimal presets keep the legacy preset path; Legacy stays untouched). */
export function styleIdForPreset(preset?: string | null): string | null {
  if (preset === "corporate") return APPLE.id;
  if (preset === "bold_creator") return HORMOZI.id;
  return null;
}
