/**
 * Visual World V1 — the brand's persistent "how it looks" object (Brand Finish
 * Layer, Phase 1). Pure + deterministic: no DB, no model calls. Materialized on
 * `brands.visual_world` (migration 029); read by video composition for grade,
 * logo, CTA end-card, and caption typography.
 *
 * Ownership boundary: this is brand-scope visual truth. It is READ by the
 * composition layer and never regenerated per video. Topic/story/tension never
 * live here. Until a brand has a stored world, `resolveVisualWorld` derives one
 * deterministically from the brand's palette so behaviour is identical to a
 * hand-tuned world (and never null).
 */

export interface VisualWorldPalette {
  primary?: string | null;
  secondary?: string | null;
  accent?: string | null;
  neutral?: string | null;
}

/** Deterministic, model-independent grade applied identically to every clip. */
export interface VisualWorldGrade {
  /** R2 object key of a .cube LUT, or null → use the eq params below. */
  lut: string | null;
  contrast: number;
  saturation: number;
  brightness: number;
}

export interface VisualWorldTypography {
  /** Font family installed in the worker (nixpacks) — e.g. "Inter", "DejaVu Sans". */
  captionFont: string;
  /** Caption height as a fraction of video height. */
  captionSizePct: number;
  /** Hex caption color, e.g. "#FFFFFF". */
  color: string;
  /** Background box opacity 0..1 behind the caption. */
  boxOpacity: number;
  case: "sentence" | "upper" | "title";
}

export interface VisualWorldLogo {
  assetId: string | null;
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  scalePct: number;
  marginPct: number;
  opacity: number;
}

export interface VisualWorldEndcard {
  enabled: boolean;
  ctaText: string | null;
  durationSec: number;
}

export interface VisualWorldV1 {
  version: 1;
  palette: VisualWorldPalette;
  grade: VisualWorldGrade;
  /** Prepended to every scene prompt (shared style — see scene-generation). */
  stylePreamble: string;
  negativePrompt: string;
  cameraGrammar: { lens: string; movement: string; cutStyle: string };
  /** Base seed; per-video seed = seedFamily XOR hash(topic). */
  seedFamily: number;
  typography: VisualWorldTypography;
  logo: VisualWorldLogo;
  endcard: VisualWorldEndcard;
}

const DEFAULT_GRADE: VisualWorldGrade = { lut: null, contrast: 1.06, saturation: 1.08, brightness: 0.0 };
// Defaults reproduce the pre-V1 ASS header exactly (Regular 72px / PlayResY
// 1920 = 0.0375; box BackColour alpha 0x80 = opacity 0.5) so a *derived* world
// changes nothing — only an explicitly authored world restyles captions.
const DEFAULT_TYPOGRAPHY: VisualWorldTypography = {
  captionFont: "DejaVu Sans",
  captionSizePct: 0.0375,
  color: "#FFFFFF",
  boxOpacity: 0.5,
  case: "sentence",
};
const DEFAULT_NEGATIVE = "no people, faces, text, letters, logos, words, brand marks";
const DEFAULT_CAMERA = { lens: "35mm", movement: "slow push-in", cutStyle: "crossfade" };

export interface DeriveVisualWorldInput {
  palette?: VisualWorldPalette | null;
  brandName?: string | null;
  brandId?: string | null;
  logoAssetId?: string | null;
  ctaText?: string | null;
  /** Stable per-brand integer for the seed family (e.g. hashed brand id). */
  seedBase?: number | null;
}

/** Deterministic style preamble from the brand's palette/worldview language. */
function styleFromPalette(p?: VisualWorldPalette | null): string {
  const colors = [p?.primary && `primary ${p.primary}`, p?.secondary && `secondary ${p.secondary}`, p?.accent && `accent ${p.accent}`]
    .filter(Boolean)
    .join(", ");
  return [
    "consistent brand visual language across the whole video",
    "calm, structured, architectural motion; soft volumetric key light; slow steady camera",
    colors ? `palette: ${colors}` : "restrained, cohesive palette",
    "matched lighting, texture and color grade so every scene reads as one continuous piece, vertical 9:16",
  ].join("; ");
}

/** Build a deterministic Visual World from a brand's palette (no DB, no model). */
export function deriveVisualWorld(input: DeriveVisualWorldInput): VisualWorldV1 {
  return {
    version: 1,
    palette: input.palette ?? {},
    grade: DEFAULT_GRADE,
    stylePreamble: styleFromPalette(input.palette),
    negativePrompt: DEFAULT_NEGATIVE,
    cameraGrammar: DEFAULT_CAMERA,
    seedFamily: (input.seedBase ?? 0) || Math.floor(Math.random() * 2 ** 31),
    typography: DEFAULT_TYPOGRAPHY,
    logo: {
      assetId: input.logoAssetId ?? null,
      position: "bottom-right",
      scalePct: 0.22,
      marginPct: 0.05,
      opacity: 0.9,
    },
    endcard: { enabled: !!input.ctaText, ctaText: input.ctaText ?? null, durationSec: 2 },
  };
}

/**
 * Resolve the world to use for a render: the brand's stored `visual_world`
 * (validated to V1) if present, otherwise a deterministic derivation from the
 * brand's palette + brief-supplied logo/CTA. Never null → composition always
 * has a brand finish to apply.
 */
export function resolveVisualWorld(
  stored: unknown,
  fallback: DeriveVisualWorldInput,
): VisualWorldV1 {
  if (stored && typeof stored === "object" && (stored as { version?: number }).version === 1) {
    const w = stored as VisualWorldV1;
    // Merge brief-supplied logo/CTA when the stored world doesn't fix them.
    return {
      ...w,
      grade: { ...DEFAULT_GRADE, ...w.grade },
      typography: { ...DEFAULT_TYPOGRAPHY, ...w.typography },
      logo: { ...w.logo, assetId: w.logo?.assetId ?? fallback.logoAssetId ?? null },
      endcard: {
        ...w.endcard,
        ctaText: w.endcard?.ctaText ?? fallback.ctaText ?? null,
        enabled: w.endcard?.enabled ?? !!(w.endcard?.ctaText ?? fallback.ctaText),
      },
    };
  }
  return deriveVisualWorld(fallback);
}
