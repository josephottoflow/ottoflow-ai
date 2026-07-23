/**
 * Creative OS Text-Style Registry (M2B) — the ONE source of truth for the
 * user-facing text styles, shared by every visual generator and BOTH renderers.
 *
 * This is a BINDING layer, not a redefinition: each style points at the design
 * tokens that already exist —
 *   • video (ASS renderer): a render profile in `../ffmpeg-pipeline/render-profile`
 *     (premium/impact → Motion-engine philosophy profiles; creative_founder →
 *     corporate register; legacy → static).
 *   • image (SVG compositor, wired in M2C): the philosophy id resolved through
 *     `../presentation/styles/registry` (getStyleFamily) → the same typography /
 *     hierarchy / colour / decoration tokens the video engine uses.
 *
 * So both renderers consume the same design language from one place; nothing here
 * duplicates a token value. The UI (TextOverlayControl) also renders its options
 * from TEXT_STYLES, so the API, both renderers, and the UI can never drift.
 */

/** The four canonical user-facing text styles. */
export type TextStyleId = "premium" | "impact" | "founder" | "legacy";

/** The reusable overlay value: OFF (clean asset) or ON with a chosen style. */
export type TextOverlay =
  | { enabled: false }
  | { enabled: true; style: TextStyleId };

export interface TextStyleDef {
  id: TextStyleId;
  /** Short label for the selector. */
  label: string;
  /** One-line description of the voice. */
  description: string;
  /**
   * Video (ASS) renderer binding — the render profile passed to the video API.
   * premium/impact resolve to Motion-engine philosophy profiles; founder to the
   * corporate register; legacy to the static caption path.
   */
  renderProfile: "premium" | "impact" | "creative_founder" | "legacy";
  /**
   * Image (SVG compositor) binding — the presentation-registry philosophy id the
   * SVG typography reads for hierarchy/colour/decoration (M2C). `null` = legacy
   * (the compositor keeps its existing deterministic typography).
   */
  philosophyId: string | null;
}

/** THE registry. Order is the selector's display order. */
export const TEXT_STYLES: readonly TextStyleDef[] = [
  { id: "premium", label: "Premium", description: "Refined editorial (Motion engine)", renderProfile: "premium", philosophyId: "premium" },
  { id: "impact", label: "Impact", description: "Bold creator (Motion engine)", renderProfile: "impact", philosophyId: "impact" },
  { id: "founder", label: "Founder", description: "Corporate register", renderProfile: "creative_founder", philosophyId: "premium" },
  { id: "legacy", label: "Legacy", description: "Static captions (default)", renderProfile: "legacy", philosophyId: null },
] as const;

const BY_ID: Record<TextStyleId, TextStyleDef> = Object.fromEntries(
  TEXT_STYLES.map((s) => [s.id, s]),
) as Record<TextStyleId, TextStyleDef>;

/** The default: legacy captions ON (the certified production behaviour). */
export const DEFAULT_TEXT_OVERLAY: TextOverlay = { enabled: true, style: "legacy" };

export function getTextStyle(id: TextStyleId): TextStyleDef {
  return BY_ID[id] ?? BY_ID.legacy;
}

/** Video binding: a style id → the render profile the video API expects. */
export function textStyleToRenderProfile(id: TextStyleId): TextStyleDef["renderProfile"] {
  return getTextStyle(id).renderProfile;
}

/**
 * Resolve a TextOverlay to the video API's per-render fields. Byte-identical
 * default: overlay ON + legacy → both undefined (nothing sent); overlay OFF →
 * textOverlay:false (suppresses headline/subtitle/CTA/decoration; the logo /
 * watermark overlay is independent and unaffected).
 */
export function overlayToVideoFields(o: TextOverlay): {
  renderProfile?: TextStyleDef["renderProfile"];
  textOverlay?: false;
} {
  if (!o.enabled) return { textOverlay: false };
  const rp = textStyleToRenderProfile(o.style);
  return rp === "legacy" ? {} : { renderProfile: rp };
}

/** Image binding: a style id → the presentation-registry philosophy id the SVG
 * compositor reads for its typography tokens (M2C). `null` = legacy. */
export function textStyleToPhilosophyId(id: TextStyleId): string | null {
  return getTextStyle(id).philosophyId;
}

/**
 * Resolve a TextOverlay to the image compositor's per-render fields — the mirror
 * of overlayToVideoFields, so BOTH renderers read the same registry. Byte-safe
 * default: overlay ON + legacy → {} (nothing set → the compositor's existing
 * deterministic typography). Overlay OFF → textOverlay:false (suppresses
 * headline/subtitle/CTA/decoration; logo / watermark / branding are independent
 * and unaffected). A non-legacy style sets textStyle so the compositor resolves
 * its typography through the shared registry.
 */
export function overlayToImageFields(o: TextOverlay): {
  textStyle?: TextStyleId;
  textOverlay?: false;
} {
  if (!o.enabled) return { textOverlay: false };
  return o.style === "legacy" ? {} : { textStyle: o.style };
}
