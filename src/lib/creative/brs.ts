/**
 * Brand Recognition Score — first pass (P4 Phase 2A, image-only).
 *
 * Automated 0–100 over five deterministic dimensions. Color is MEASURED from
 * the rendered pixels (is a brand color actually present?); the other four are
 * application-confirmed (did the deterministic identity layer get applied?) —
 * high by construction, which is the point: it verifies the pipeline stamped
 * identity. The TRUE recognition metric is the logo-masked blind-attribution
 * test (vision-LLM + human), run separately; this score is the cheap per-render
 * proxy + regression guard.
 *
 * Weights: Color 30 · Motif 20 · Composition 20 · Typography 20 · Spacing 10.
 */
import sharp from "sharp";
import type { BrandPattern } from "./types";

export interface BRSResult {
  score: number; // 0..100
  dimensions: { color: number; motif: number; composition: number; typography: number; spacing: number };
}

interface RGB { r: number; g: number; b: number }

function hexToRgb(hex?: string | null): RGB | null {
  if (!hex) return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

/** Normalized RGB distance 0 (identical) .. 1 (opposite corner). */
function dist(a: RGB, b: RGB): number {
  const d = Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
  return Math.min(1, d / (Math.sqrt(3) * 255));
}

export interface BRSPalette {
  primary?: string | null;
  secondary?: string | null;
  accent?: string | null;
}

/**
 * Compute the BRS for a rendered creative PNG against its brand pattern.
 * `palette` is the brand palette (from the brief) for the color measurement.
 */
export async function computeBRS(
  png: Buffer,
  pattern: BrandPattern | null,
  palette: BRSPalette,
): Promise<BRSResult> {
  const dimensions = { color: 0, motif: 0, composition: 0, typography: 0, spacing: 0 };

  // Color (30): is a brand palette color actually present? Compare the image's
  // dominant + mean color to the nearest brand color; reward proximity.
  const targets = [palette.primary, palette.secondary, palette.accent]
    .map(hexToRgb)
    .filter((x): x is RGB => x !== null);
  if (targets.length > 0) {
    const stats = await sharp(png).stats();
    const dominant = stats.dominant as RGB;
    const mean: RGB = {
      r: stats.channels[0]?.mean ?? 0,
      g: stats.channels[1]?.mean ?? 0,
      b: stats.channels[2]?.mean ?? 0,
    };
    const best = Math.min(
      ...targets.map((t) => Math.min(dist(dominant, t), dist(mean, t))),
    );
    dimensions.color = Math.round(30 * (1 - best));
  }

  // Motif / Composition / Typography / Spacing: application-confirmed.
  dimensions.motif = pattern?.motif_dna ? 20 : 0;
  dimensions.composition = pattern?.composition_dna?.template ? 20 : 0;
  dimensions.typography = pattern?.typography_dna ? 20 : 0;
  dimensions.spacing = pattern?.spacing_dna ? 10 : 0;

  const score = Math.max(
    0,
    Math.min(
      100,
      dimensions.color + dimensions.motif + dimensions.composition + dimensions.typography + dimensions.spacing,
    ),
  );
  return { score, dimensions };
}
