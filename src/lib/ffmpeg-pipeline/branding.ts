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
 * Greedy word-wrap to fit a pixel width at a given font size (Arial bold).
 * Char advance ≈ 0.56em for Arial bold — deliberately conservative so a line
 * never exceeds the safe width and clips off-canvas (cert 2594ea2e defect). A
 * single word longer than the line is hard-broken so it can't overflow either.
 */
function wrapText(text: string, maxWidthPx: number, fontPx: number): string[] {
  const AVG_ADVANCE = 0.56;
  const maxChars = Math.max(6, Math.floor(maxWidthPx / (fontPx * AVG_ADVANCE)));
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = candidate;
    }
    while (cur.length > maxChars) {
      lines.push(cur.slice(0, maxChars));
      cur = cur.slice(maxChars);
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}

/**
 * Render a 9:16 CTA end card as a PNG. Palette-driven gradient + a CTA block
 * that AUTO-WRAPS and AUTO-SCALES to fit any length within the safe area, an
 * accent underline placed beneath the (variable-height) block, then the brand
 * name — each element stacked with margins so they never overlap (cert 2594ea2e
 * showed clipped + overlapping CTA text). The logo (if any) is composited on
 * top, never drawn by a model; the V1 composer omits it so the global
 * bottom-right overlay is the single brand mark (no duplicate logo).
 */
export async function renderCtaCard(input: CtaCardInput): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const { width, height } = input;
  const top = input.palette?.primary || NEUTRAL_TOP;
  const bottom = input.palette?.secondary || NEUTRAL_BOTTOM;
  const accent = input.palette?.accent || NEUTRAL_ACCENT;
  const ctaRaw = input.ctaText.trim().slice(0, 120); // wrap handles length now
  const brand = input.brandName ? esc(input.brandName.slice(0, 40)) : "";

  const cx = width / 2;
  const safeWidth = width * 0.86; // 7% horizontal safe margin each side
  const maxLines = 3;
  const minFont = Math.round(width * 0.045);
  const maxFont = Math.round(width * 0.072);

  // Auto-scale: shrink the font until the wrapped CTA fits within maxLines.
  let ctaFont = maxFont;
  let lines = wrapText(ctaRaw, safeWidth, ctaFont);
  while (lines.length > maxLines && ctaFont > minFont) {
    ctaFont = Math.max(minFont, ctaFont - Math.round(width * 0.006));
    lines = wrapText(ctaRaw, safeWidth, ctaFont);
  }
  // Pathological CTA still longer than maxLines at the floor → ellipsize.
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.\s]+$/, "")}…`;
  }

  const lineHeight = Math.round(ctaFont * 1.18);
  const blockHeight = lines.length * lineHeight;
  const brandFont = Math.round(width * 0.04);

  // Vertically center the CTA block; stack underline + brand strictly beneath it.
  const blockTop = Math.round(height * 0.5 - blockHeight / 2);
  const firstBaseline = blockTop + Math.round(ctaFont * 0.82);
  const underlineY = blockTop + blockHeight + Math.round(ctaFont * 0.5);
  const underlineH = Math.max(4, Math.round(width * 0.012));
  const brandBaseline = underlineY + underlineH + brandFont + Math.round(height * 0.012);

  const ctaLines = lines
    .map(
      (ln, i) =>
        `<text x="${cx}" y="${firstBaseline + i * lineHeight}" font-family="Arial, Helvetica, sans-serif" font-size="${ctaFont}" font-weight="700" fill="#ffffff" text-anchor="middle">${esc(ln)}</text>`,
    )
    .join("\n  ");

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${top}"/>
      <stop offset="100%" stop-color="${bottom}"/>
    </linearGradient>
    <linearGradient id="ul" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0"/>
      <stop offset="50%" stop-color="${accent}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  ${ctaLines}
  <rect x="${cx - width * 0.2}" y="${underlineY}" width="${width * 0.4}" height="${underlineH}" fill="url(#ul)"/>
  ${brand ? `<text x="${cx}" y="${brandBaseline}" font-family="Arial, Helvetica, sans-serif" font-size="${brandFont}" font-weight="500" fill="#e2e8f0" text-anchor="middle" opacity="0.85">${brand}</text>` : ""}
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
