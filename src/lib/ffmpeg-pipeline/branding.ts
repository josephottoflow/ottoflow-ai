/**
 * Deterministic video branding assets (Ottoflow Video V1).
 *
 * Same philosophy as the still-creative compositor: AI never produces brand
 * marks. The logo bytes are composited pixel-for-pixel; the CTA end card is a
 * sharp-rendered palette gradient + SVG typography. Nothing here is sent to a
 * model. FFmpeg overlays the logo and concatenates the CTA card.
 */
// NOTE: `sharp` is imported lazily inside renderCtaCard (the only consumer).
// Top-level `import sharp from "sharp"` would crash the Vercel /api/video/generate
// route at module-init ("Could not load the sharp module"), because that route
// transitively imports this file via orchestrator → agent 11. sharp only ever
// runs in the worker, so a dynamic import keeps it out of the Vercel import graph.
import { createAdminClient } from "@/lib/supabase";

export interface VideoPalette {
  primary?: string | null;
  secondary?: string | null;
  accent?: string | null;
}

export interface CtaCardInput {
  width: number;
  height: number;
  ctaText: string;
  brandName?: string | null;
  palette?: VideoPalette | null;
  /** Optional locked logo bytes to center near the top. */
  logo?: Buffer | null;
}

// Neutral slate fallback — matches the still-creative decision to drop the
// old #7c3aed purple fallback in favour of a palette-neutral base.
const NEUTRAL_TOP = "#1e293b";
const NEUTRAL_BOTTOM = "#0f172a";
const NEUTRAL_ACCENT = "#64748b";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Render a 9:16 CTA end card as a PNG. Palette-driven gradient + centered CTA
 * line + accent underline + optional brand name. The logo (if any) is
 * composited on top, never drawn by a model.
 */
export async function renderCtaCard(input: CtaCardInput): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const { width, height } = input;
  const top = input.palette?.primary || NEUTRAL_TOP;
  const bottom = input.palette?.secondary || NEUTRAL_BOTTOM;
  const accent = input.palette?.accent || NEUTRAL_ACCENT;
  const cta = esc(input.ctaText.slice(0, 60));
  const brand = input.brandName ? esc(input.brandName.slice(0, 40)) : "";

  const cx = width / 2;
  const cyText = height * 0.55;
  const ctaFont = Math.round(width * 0.072);
  const brandFont = Math.round(width * 0.04);

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${top}"/>
      <stop offset="100%" stop-color="${bottom}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect x="${cx - width * 0.12}" y="${cyText + ctaFont * 0.55}" width="${width * 0.24}" height="${Math.max(4, width * 0.012)}" rx="3" fill="${accent}"/>
  <text x="${cx}" y="${cyText}" font-family="Arial, Helvetica, sans-serif" font-size="${ctaFont}" font-weight="700" fill="#ffffff" text-anchor="middle">${cta}</text>
  ${brand ? `<text x="${cx}" y="${height * 0.72}" font-family="Arial, Helvetica, sans-serif" font-size="${brandFont}" font-weight="500" fill="#e2e8f0" text-anchor="middle" opacity="0.85">${brand}</text>` : ""}
</svg>`;

  let img = sharp(Buffer.from(svg)).png();
  let png = await img.toBuffer();

  if (input.logo) {
    // Center the logo in the upper third, sized to ~32% width.
    const logoW = Math.round(width * 0.32);
    const resizedLogo = await sharp(input.logo)
      .resize({ width: logoW, withoutEnlargement: true })
      .png()
      .toBuffer();
    const meta = await sharp(resizedLogo).metadata();
    const left = Math.round(cx - (meta.width ?? logoW) / 2);
    const topY = Math.round(height * 0.2);
    png = await sharp(png)
      .composite([{ input: resizedLogo, left, top: topY }])
      .png()
      .toBuffer();
  }

  return png;
}

/**
 * Download a locked logo asset's raw bytes from the brand-assets bucket.
 * These bytes are composited pixel-for-pixel and NEVER sent to any AI model.
 * (Same path as worker/processors/creative-generation.ts downloadAssetBytes.)
 */
export async function fetchLogoBytes(
  admin: ReturnType<typeof createAdminClient>,
  assetId: string,
): Promise<Buffer | null> {
  const { data: asset } = await admin
    .from("brand_assets")
    .select("storage_path")
    .eq("id", assetId)
    .maybeSingle();
  if (!asset?.storage_path) return null;
  const { data: blob, error } = await admin.storage
    .from("brand-assets")
    .download(asset.storage_path as string);
  if (error || !blob) return null;
  return Buffer.from(await blob.arrayBuffer());
}
