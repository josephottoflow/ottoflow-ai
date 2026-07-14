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
  /** Per-render end-screen mode (Video Quality V2). "animated" = premium card
   * (vignette/glow/spacing); "classic"/absent = byte-identical Legacy card.
   * Passed EXPLICITLY per render by the composer — no global default. */
  endScreenMode?: "classic" | "animated";
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

  // End Screen V2 (END_SCREEN_MODE): additive cinematic depth — a soft radial
  // vignette + an accent glow behind the CTA + subtle letter-spacing. Default
  // (classic/unset) emits NONE of these, so the rendered PNG is byte-identical
  // to today. Rollback is a single flag. No new dependency (same sharp+SVG).
  // Per-render flag wins; END_SCREEN_MODE is a dev-only override used only when
  // no per-render mode is passed. Neither → classic (byte-identical Legacy card).
  const endMode = (process.env.END_SCREEN_MODE ?? "").trim().toLowerCase();
  const premiumEnd =
    input.endScreenMode === "animated" ||
    (input.endScreenMode === undefined && ["premium", "animated", "v2", "modern"].includes(endMode));
  const ls = premiumEnd ? ` letter-spacing="${Math.round(ctaFont * 0.02)}"` : "";
  const brandLs = premiumEnd ? ` letter-spacing="${Math.round(brandFont * 0.06)}"` : "";
  const premiumDefs = premiumEnd
    ? `<radialGradient id="vig" cx="50%" cy="42%" r="75%">
      <stop offset="55%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.45"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>`
    : "";
  const premiumGlow = premiumEnd
    ? `<ellipse cx="${cx}" cy="${Math.round(height * 0.5)}" rx="${Math.round(width * 0.42)}" ry="${Math.round(blockHeight * 0.9 + ctaFont)}" fill="url(#glow)"/>`
    : "";
  const premiumVignette = premiumEnd
    ? `<rect width="${width}" height="${height}" fill="url(#vig)"/>`
    : "";

  const ctaLines = lines
    .map(
      (ln, i) =>
        `<text x="${cx}" y="${firstBaseline + i * lineHeight}" font-family="Arial, Helvetica, sans-serif" font-size="${ctaFont}" font-weight="700" fill="#ffffff" text-anchor="middle"${ls}>${esc(ln)}</text>`,
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
    ${premiumDefs}
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  ${premiumGlow}
  ${ctaLines}
  <rect x="${cx - width * 0.2}" y="${underlineY}" width="${width * 0.4}" height="${underlineH}" fill="url(#ul)"/>
  ${brand ? `<text x="${cx}" y="${brandBaseline}" font-family="Arial, Helvetica, sans-serif" font-size="${brandFont}" font-weight="500" fill="#e2e8f0" text-anchor="middle" opacity="0.85"${brandLs}>${brand}</text>` : ""}
  ${premiumVignette}
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
 * End Screen V3 — layered outro assets (Presentation Engine V4, Phase 5).
 *
 * Renders the CTA end card as SEPARATE full-frame transparent PNG layers so the
 * composer can choreograph a CINEMATIC animated final scene (moving/glowing
 * background + staggered element reveals) instead of a static held slide. Each
 * element layer is the full frame size with a TRANSPARENT background and only its
 * own element drawn AT ITS FINAL RESTING POSITION — so ffmpeg composites them with
 * a plain `overlay=0:0` (no per-element geometry in the filtergraph) and only the
 * reveal timing/opacity is animated.
 *
 * Geometry is intentionally duplicated from renderCtaCard (NOT refactored) so that
 * function stays byte-frozen for the Legacy/classic card. This function is used
 * ONLY for Modern "animated" end screens and always renders the premium
 * background (glow + vignette). Fail-safe: returns null on ANY error, so the
 * composer degrades to the guaranteed static card.
 */
export interface CtaCardLayers {
  /** Opaque base: gradient + accent glow + vignette (no text). */
  background: Buffer;
  /** Transparent full-frame CTA text layer. */
  cta: Buffer;
  /** Transparent full-frame accent underline layer. */
  underline: Buffer;
  /** Transparent full-frame brand-name layer (null when no brand name). */
  brand: Buffer | null;
}

export async function renderCtaCardLayers(
  input: CtaCardInput,
): Promise<CtaCardLayers | null> {
  try {
    const { default: sharp } = await import("sharp");
    const { width, height } = input;
    const top = input.palette?.primary || NEUTRAL_TOP;
    const bottom = input.palette?.secondary || NEUTRAL_BOTTOM;
    const accent = input.palette?.accent || NEUTRAL_ACCENT;
    const ctaRaw = input.ctaText.trim().slice(0, 120);
    const brand = input.brandName ? esc(input.brandName.slice(0, 40)) : "";

    const cx = width / 2;
    const safeWidth = width * 0.86;
    const maxLines = 3;
    const minFont = Math.round(width * 0.045);
    const maxFont = Math.round(width * 0.072);

    // Auto-scale (identical rule to renderCtaCard) so positions match the card.
    let ctaFont = maxFont;
    let lines = wrapText(ctaRaw, safeWidth, ctaFont);
    while (lines.length > maxLines && ctaFont > minFont) {
      ctaFont = Math.max(minFont, ctaFont - Math.round(width * 0.006));
      lines = wrapText(ctaRaw, safeWidth, ctaFont);
    }
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.\s]+$/, "")}…`;
    }

    const lineHeight = Math.round(ctaFont * 1.18);
    const blockHeight = lines.length * lineHeight;
    const brandFont = Math.round(width * 0.04);
    const blockTop = Math.round(height * 0.5 - blockHeight / 2);
    const firstBaseline = blockTop + Math.round(ctaFont * 0.82);
    const underlineY = blockTop + blockHeight + Math.round(ctaFont * 0.5);
    const underlineH = Math.max(4, Math.round(width * 0.012));
    const brandBaseline = underlineY + underlineH + brandFont + Math.round(height * 0.012);
    const ls = ` letter-spacing="${Math.round(ctaFont * 0.02)}"`;
    const brandLs = ` letter-spacing="${Math.round(brandFont * 0.06)}"`;

    // ── Layer 1: premium background (gradient + accent glow + vignette). ──────
    const backgroundSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${top}"/>
      <stop offset="100%" stop-color="${bottom}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vig" cx="50%" cy="42%" r="75%">
      <stop offset="55%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.45"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <ellipse cx="${cx}" cy="${Math.round(height * 0.5)}" rx="${Math.round(width * 0.42)}" ry="${Math.round(blockHeight * 0.9 + ctaFont)}" fill="url(#glow)"/>
  <rect width="${width}" height="${height}" fill="url(#vig)"/>
</svg>`;

    // ── Layer 2: CTA text (transparent). ─────────────────────────────────────
    const ctaLines = lines
      .map(
        (ln, i) =>
          `<text x="${cx}" y="${firstBaseline + i * lineHeight}" font-family="Arial, Helvetica, sans-serif" font-size="${ctaFont}" font-weight="700" fill="#ffffff" text-anchor="middle"${ls}>${esc(ln)}</text>`,
      )
      .join("\n  ");
    const ctaSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  ${ctaLines}
</svg>`;

    // ── Layer 3: accent underline (transparent). ─────────────────────────────
    const underlineSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ul" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0"/>
      <stop offset="50%" stop-color="${accent}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="${cx - width * 0.2}" y="${underlineY}" width="${width * 0.4}" height="${underlineH}" fill="url(#ul)"/>
</svg>`;

    // ── Layer 4: brand name (transparent; omitted when no brand). ────────────
    const brandSvg = brand
      ? `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <text x="${cx}" y="${brandBaseline}" font-family="Arial, Helvetica, sans-serif" font-size="${brandFont}" font-weight="500" fill="#e2e8f0" text-anchor="middle" opacity="0.85"${brandLs}>${brand}</text>
</svg>`
      : null;

    const [background, cta, underline, brandBuf] = await Promise.all([
      sharp(Buffer.from(backgroundSvg)).png().toBuffer(),
      sharp(Buffer.from(ctaSvg)).png().toBuffer(),
      sharp(Buffer.from(underlineSvg)).png().toBuffer(),
      brandSvg ? sharp(Buffer.from(brandSvg)).png().toBuffer() : Promise.resolve(null),
    ]);
    return { background, cta, underline, brand: brandBuf };
  } catch {
    // Fail-safe: the composer falls back to the static renderCtaCard card.
    return null;
  }
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
