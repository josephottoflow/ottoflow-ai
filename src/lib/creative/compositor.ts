/**
 * Deterministic creative compositor (Phase C). Server/worker only.
 *
 * OPERATION WHITELIST — the ONLY things this module does to LOCKED assets
 * (logos, headshots):
 *   resize    sharp().resize() — proportional, no enlargement beyond source
 *   crop      resize fit:'cover' (center/attention crop)
 *   mask      circular alpha mask via dest-in composite (headshots)
 *   position  placement onto the canvas at computed coordinates
 *
 * Explicitly NOT done, by design (Creative Orchestrator safety rules):
 * no enhancement, no recoloring, no beautification, no stylization, no
 * recreation, no regeneration. Asset bytes never reach an AI model — this
 * module receives raw buffers fetched from storage and composites them
 * pixel-for-pixel.
 *
 * Headline / CTA / wordmark / attribution are rendered as SVG text layers —
 * deterministic typography, NOT asset modification (and the reason generated
 * backgrounds must never contain text: all words on a creative come from the
 * approved brief, crisply rendered here).
 *
 * A legibility scrim (translucent gradient) is applied to the AI-GENERATED
 * background only — backgrounds aren't locked assets.
 */
import sharp from "sharp";
import type { BrandPattern, CreativeBrief, Placement } from "./types";
import { getTemplateLayout } from "./composition-templates";
import { renderMotifSvg } from "./motifs";

export interface CompositeInput {
  brief: CreativeBrief;
  /** AI-generated background (validated: no text/logos/faces). */
  background: Buffer;
  /** Locked asset bytes — pass-through pixels only. */
  logo: Buffer | null;
  headshot: Buffer | null;
  brandName: string;
  founderName: string | null;
  /** Active Brand Pattern (P4 Phase 2A). Absent → renders exactly as before. */
  pattern?: BrandPattern | null;
}

// Native per-platform creative dimensions (px). The background is cover-cropped
// to these exact dimensions, so each platform gets a correctly-sized asset.
const CANVAS_BY_PLATFORM: Record<string, { w: number; h: number }> = {
  linkedin: { w: 1200, h: 627 },
  facebook: { w: 1200, h: 630 },
  twitter: { w: 1600, h: 900 },
  instagram: { w: 1080, h: 1350 },
  blog: { w: 1600, h: 900 },
  email: { w: 1200, h: 630 },
};

// Fallback by Imagen aspect ratio when the platform isn't in the map above.
const CANVAS_BY_ASPECT: Record<CreativeBrief["aspect_ratio"], { w: number; h: number }> = {
  "1:1": { w: 1080, h: 1080 },
  "3:4": { w: 1080, h: 1350 },
  "16:9": { w: 1200, h: 630 },
  "9:16": { w: 1080, h: 1920 },
};

function resolveCanvas(brief: CreativeBrief): { w: number; h: number } {
  return CANVAS_BY_PLATFORM[brief.platform] ?? CANVAS_BY_ASPECT[brief.aspect_ratio];
}

const FONT_STACK = "DejaVu Sans, Arial, Helvetica, sans-serif";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Allow hex / simple named colors only — anything else falls back. */
function safeColor(c: string | undefined, fallback: string): string {
  if (c && /^#?[0-9a-zA-Z]{1,20}$/.test(c)) return c.startsWith("#") || /^[a-zA-Z]+$/.test(c) ? c : `#${c}`;
  return fallback;
}

// Non-branded fallbacks — used ONLY when a brand has no palette configured.
// Never Ottoflow purple: a creative must not inherit Ottoflow's identity.
const NEUTRAL_ACCENT = "#64748b"; // slate-500
const NEUTRAL_SCRIM = { r: 10, g: 12, b: 16 } as const; // neutral near-black

type RGB = { r: number; g: number; b: number };
function parseHex(c?: string): RGB | null {
  if (!c) return null;
  let h = c.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}
function rgbaStr(c: RGB, alpha: number): string {
  return `rgba(${c.r},${c.g},${c.b},${alpha})`;
}

/** Greedy word wrap from an average-glyph-width estimate. */
function wrapText(text: string, fontSize: number, maxWidthPx: number): string[] {
  const charW = fontSize * 0.56;
  const maxChars = Math.max(8, Math.floor(maxWidthPx / charW));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 5); // hard cap — briefs limit headline to 80 chars anyway
}

function placementXY(
  placement: Placement,
  elemW: number,
  elemH: number,
  W: number,
  H: number,
  m: number,
): { x: number; y: number } {
  switch (placement) {
    case "top_left": return { x: m, y: m };
    case "top_right": return { x: W - elemW - m, y: m };
    case "bottom_left": return { x: m, y: H - elemH - m };
    case "bottom_right": return { x: W - elemW - m, y: H - elemH - m };
    case "center": return { x: Math.round((W - elemW) / 2), y: Math.round((H - elemH) / 2) };
    case "left_third": return { x: m, y: Math.round((H - elemH) / 2) };
    case "right_third": return { x: W - elemW - m, y: Math.round((H - elemH) / 2) };
    case "bottom_bar": return { x: m, y: H - elemH - m };
  }
}

interface TextBlock {
  svg: string;
  height: number;
}

function headlineBlock(
  text: string,
  fontSize: number,
  maxWidth: number,
  x: number,
  startY: number,
  anchor: "start" | "middle",
  quote = false,
): TextBlock {
  const lines = wrapText(text, fontSize, maxWidth);
  const lineH = Math.round(fontSize * 1.18);
  const body = lines
    .map(
      (ln, i) =>
        `<text x="${x}" y="${startY + (i + 1) * lineH}" text-anchor="${anchor}" ` +
        `font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="800" ` +
        `fill="#ffffff" style="paint-order:stroke" stroke="rgba(0,0,0,0.25)" stroke-width="2">${esc(ln)}</text>`,
    )
    .join("");
  const quoteMark = quote
    ? `<text x="${x}" y="${startY}" text-anchor="${anchor}" font-family="${FONT_STACK}" ` +
      `font-size="${fontSize * 1.6}" font-weight="800" fill="rgba(255,255,255,0.45)">“</text>`
    : "";
  return { svg: quoteMark + body, height: lines.length * lineH + (quote ? fontSize : 0) };
}

/** Lighter supporting line under the headline. */
function subBlock(
  text: string,
  fontSize: number,
  maxWidth: number,
  x: number,
  startY: number,
  anchor: "start" | "middle",
): TextBlock {
  const lines = wrapText(text, fontSize, maxWidth).slice(0, 2);
  const lineH = Math.round(fontSize * 1.25);
  const body = lines
    .map(
      (ln, i) =>
        `<text x="${x}" y="${startY + (i + 1) * lineH}" text-anchor="${anchor}" ` +
        `font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="500" ` +
        `fill="rgba(255,255,255,0.85)">${esc(ln)}</text>`,
    )
    .join("");
  return { svg: body, height: lines.length * lineH };
}

function ctaPill(
  text: string,
  fontSize: number,
  centerX: number,
  topY: number,
  accent: string,
): TextBlock {
  const padX = Math.round(fontSize * 1.2);
  const w = Math.round(text.length * fontSize * 0.56 + padX * 2);
  const h = Math.round(fontSize * 2.1);
  const x = Math.round(centerX - w / 2);
  return {
    svg:
      `<rect x="${x}" y="${topY}" width="${w}" height="${h}" rx="${h / 2}" fill="${accent}"/>` +
      `<text x="${centerX}" y="${topY + h / 2 + fontSize * 0.36}" text-anchor="middle" ` +
      `font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="700" fill="#ffffff">${esc(text)}</text>`,
    height: h,
  };
}

/**
 * Decode-validate a locked asset buffer. Returns it only if sharp/libvips can
 * actually read it, else null. A corrupt upload (valid magic bytes but
 * undecodable data — now rejected at the upload route, this is the worker-side
 * backstop) is SKIPPED so a single bad asset degrades the layout instead of
 * hard-failing the whole creative. Read-only: the bytes are never modified.
 */
async function decodableOrNull(buf: Buffer | null): Promise<Buffer | null> {
  if (!buf) return null;
  try {
    await sharp(buf).metadata();
    return buf;
  } catch {
    return null;
  }
}

/**
 * Deterministic brand color grade (P4 Phase 2A, z1) — applied to the
 * AI-generated background ONLY (never to locked assets). recomb is a 3×3
 * brand matrix; modulate nudges saturation/hue/brightness. (duotone is in the
 * schema for future use; sharp has no native duotone, so it's a no-op here.)
 */
async function applyColorGrade(
  buf: Buffer,
  cd: NonNullable<BrandPattern["color_dna"]>,
): Promise<Buffer> {
  let img = sharp(buf);
  if (cd.recomb && cd.recomb.length === 3) {
    img = img.recomb(
      cd.recomb as [
        [number, number, number],
        [number, number, number],
        [number, number, number],
      ],
    );
  }
  if (cd.modulate) {
    img = img.modulate({
      saturation: cd.modulate.saturation,
      hue: cd.modulate.hue,
      brightness: cd.modulate.brightness,
    });
  }
  return img.png().toBuffer();
}

/**
 * Deterministic, guaranteed-clean fallback background — rendered directly with
 * sharp (NEVER Imagen), so it cannot contain text, logos, faces, symbols, or
 * objects. Used when Imagen's background fails safety validation after all
 * attempts: the creative still produces a usable image instead of failing.
 * Uses the brand palette when available, a neutral dark palette otherwise.
 */
export async function renderFallbackBackground(brief: CreativeBrief): Promise<Buffer> {
  const { w: W, h: H } = resolveCanvas(brief);
  const p = brief.palette ?? {};
  const base1 = parseHex(p.primary) ?? { r: 26, g: 29, b: 36 };
  const base2 =
    parseHex(p.secondary) ?? parseHex(p.accent) ?? mix(base1, { r: 64, g: 70, b: 82 }, 0.6);
  // Deepen slightly so the headline + scrim still read. Pure gradient, no content.
  const c1 = mix(base1, { r: 12, g: 14, b: 18 }, 0.35);
  const c2 = mix(base2, { r: 12, g: 14, b: 18 }, 0.25);
  const svg =
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="rgb(${c1.r},${c1.g},${c1.b})"/>` +
    `<stop offset="100%" stop-color="rgb(${c2.r},${c2.g},${c2.b})"/>` +
    `</linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#bg)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Composite the final creative. Returns PNG bytes.
 */
export async function compositeCreative(input: CompositeInput): Promise<Buffer> {
  const { brief, pattern } = input;
  // Skip any locked asset that can't be decoded rather than failing the job.
  const logo = await decodableOrNull(input.logo);
  const headshot = await decodableOrNull(input.headshot);
  const { w: W, h: H } = resolveCanvas(brief);
  // Composition template (brand spatial signature) × hierarchy. Null → today's
  // per-hierarchy defaults. spacing_dna/template can override the margin.
  const tpl = pattern?.composition_dna?.template
    ? getTemplateLayout(pattern.composition_dna.template, brief.hierarchy)
    : null;
  const marginRatio = pattern?.spacing_dna?.margin_ratio ?? tpl?.marginRatio ?? 0.05;
  const m = Math.round(Math.min(W, H) * marginRatio);
  // Brand accent — never Ottoflow purple. Neutral slate when no palette is set.
  const accent = safeColor(brief.palette.accent ?? brief.palette.primary, NEUTRAL_ACCENT);
  // Scrim tint derived from the brand primary, mixed ~86% toward near-black so
  // it stays dark enough for white text (subtle brand tint, never a full
  // recolor). Neutral near-black when the brand has no palette.
  const primaryRgb = parseHex(brief.palette.primary ?? brief.palette.accent);
  const scrimRgb = primaryRgb ? mix(primaryRgb, { r: 8, g: 10, b: 14 }, 0.86) : NEUTRAL_SCRIM;

  // 1. Background: cover-resize, then apply the deterministic brand color
  //    grade (z1) when a pattern defines one. Locked assets are NEVER graded.
  let bg = await sharp(input.background)
    .resize(W, H, { fit: "cover", position: "centre" })
    .toBuffer();
  if (pattern?.color_dna) bg = await applyColorGrade(bg, pattern.color_dna);

  const layers: sharp.OverlayOptions[] = [];

  // z2. Brand motif overlay — deterministic, BELOW the scrim so it reads as a
  //     brand texture, not clutter over the headline. Only when defined.
  if (pattern?.motif_dna) {
    const md = pattern.motif_dna;
    const cap = pattern.do_not_use?.max_motif_opacity ?? 1;
    const motifSvg = renderMotifSvg({
      family: md.family,
      W,
      H,
      primary: safeColor(brief.palette.primary, NEUTRAL_ACCENT),
      secondary: safeColor(brief.palette.secondary ?? brief.palette.primary, NEUTRAL_ACCENT),
      accent: safeColor(brief.palette.accent ?? brief.palette.primary, NEUTRAL_ACCENT),
      opacity: Math.min(md.opacity ?? 0.12, cap),
      scale: md.scale ?? 0.7,
      placement: md.placement ?? tpl?.motifPlacement ?? "center_bleed",
    });
    layers.push({
      input: Buffer.from(motifSvg),
      top: 0,
      left: 0,
      blend: (md.blend ?? "screen") as sharp.Blend,
    });
  }

  // 2. Legibility scrim over the generated background (not a locked asset).
  const scrim = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${rgbaStr(scrimRgb, 0.2)}"/>
      <stop offset="62%" stop-color="${rgbaStr(scrimRgb, 0.38)}"/>
      <stop offset="100%" stop-color="${rgbaStr(scrimRgb, 0.66)}"/>
    </linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
  </svg>`;
  layers.push({ input: Buffer.from(scrim), top: 0, left: 0 });

  // 3. Locked assets — whitelist ops only (resize / crop / mask / position).
  const h = brief.hierarchy;

  // Headshot: cover-crop to a square, circular dest-in mask, positioned.
  let headshotLayer: { x: number; y: number; d: number } | null = null;
  if (brief.headshot_usage.use && headshot) {
    const hero = h === "founder_led";
    const d = Math.round(hero ? H * 0.42 : H * 0.11);
    const square = await sharp(headshot)
      .resize(d, d, { fit: "cover", position: sharp.strategy.attention })
      .png()
      .toBuffer();
    const circleMask = Buffer.from(
      `<svg width="${d}" height="${d}" xmlns="http://www.w3.org/2000/svg"><circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="#fff"/></svg>`,
    );
    const round = await sharp(square)
      .composite([{ input: circleMask, blend: "dest-in" }])
      .png()
      .toBuffer();
    const pos = placementXY(
      brief.headshot_usage.placement ?? tpl?.headshotBias ?? (hero ? "right_third" : "bottom_left"),
      d, d, W, H, m,
    );
    headshotLayer = { ...pos, d };
    layers.push({ input: round, top: pos.y, left: pos.x });
  }

  // Logo: proportional fit inside a box, on a light chip for guaranteed
  // contrast (the chip is drawn by us; the logo pixels are untouched).
  if (brief.logo_usage.use && logo) {
    const hero = h === "brand_led";
    const boxW = Math.round(W * (hero ? 0.34 : 0.2));
    const boxH = Math.round(H * (hero ? 0.16 : 0.08));
    const logoImg = await sharp(logo)
      .resize(boxW, boxH, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    const meta = await sharp(logoImg).metadata();
    const lw = meta.width ?? boxW;
    const lh = meta.height ?? boxH;
    const pad = Math.round(Math.min(W, H) * 0.018);
    const chipW = lw + pad * 2;
    const chipH = lh + pad * 2;
    const placement = brief.logo_usage.placement ?? tpl?.logoBias ?? (hero ? "center" : "bottom_right");
    let pos = placementXY(placement, chipW, chipH, W, H, m);
    if (hero) {
      // brand_led: logo sits just below vertical center so the headline owns
      // the upper third.
      pos = { x: pos.x, y: Math.round(H * 0.5) };
    }
    const chip = Buffer.from(
      `<svg width="${chipW}" height="${chipH}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect width="${chipW}" height="${chipH}" rx="${Math.round(pad * 0.9)}" fill="rgba(255,255,255,0.94)"/></svg>`,
    );
    layers.push({ input: chip, top: pos.y, left: pos.x });
    layers.push({ input: logoImg, top: pos.y + pad, left: pos.x + pad });
  }

  // 4. Typography layer — headline, subheadline, CTA, wordmark, attribution.
  const blocks: string[] = [];

  // Per-hierarchy text layout (anchor + position), then a uniform
  // headline → subheadline → CTA stack so the optional subheadline pushes the
  // CTA down instead of overlapping it.
  let fs: number, maxW: number, tx: number, startY: number;
  let anchor: "start" | "middle" = "middle";
  let quote = false;
  let ctaFixedY: number | null = null;
  if (h === "founder_led" && headshotLayer) {
    maxW = headshotLayer.x - m * 2; fs = Math.round(W * 0.052); tx = m; startY = Math.round(H * 0.3); anchor = "start";
  } else if (h === "brand_led") {
    fs = Math.round(W * 0.056); maxW = W - m * 2; tx = Math.round(W / 2); startY = Math.round(H * 0.16); ctaFixedY = Math.round(H * 0.74);
  } else if (h === "data_led") {
    fs = Math.round(W * 0.072); maxW = W - m * 2; tx = Math.round(W / 2); startY = Math.round(H * 0.3);
  } else {
    fs = Math.round(W * 0.05); maxW = W - m * 2; tx = Math.round(W / 2); startY = Math.round(H * 0.26); quote = true;
  }

  // Brand composition template overrides the SPATIAL signature (anchor/start/
  // x/maxWidth/CTA placement) while keeping the hierarchy's font size + quote
  // treatment. founder_led keeps its headshot-aware maxW. Null tpl → unchanged.
  if (tpl) {
    anchor = tpl.anchor;
    startY = Math.round(H * tpl.headlineStartYRatio);
    tx = anchor === "start" ? m : Math.round(W * tpl.headlineXRatio);
    if (!(h === "founder_led" && headshotLayer)) {
      maxW = Math.round(W * tpl.headlineMaxWidthRatio);
    }
    ctaFixedY =
      tpl.cta === "fixed_bottom"
        ? Math.round(H * (tpl.ctaYRatio ?? 0.82))
        : tpl.cta === "fixed_center"
          ? Math.round(H * (tpl.ctaYRatio ?? 0.74))
          : null;
  }

  const hb = headlineBlock(brief.headline, fs, maxW, tx, startY, anchor, quote);
  blocks.push(hb.svg);
  let cursorY = startY + hb.height;
  if (brief.subheadline) {
    const sb = subBlock(brief.subheadline, Math.round(fs * 0.42), maxW, tx, cursorY + Math.round(m * 0.3), anchor);
    blocks.push(sb.svg);
    cursorY += Math.round(m * 0.3) + sb.height;
  }
  const ctaX = anchor === "start" ? m + Math.round(maxW / 2) : tx;
  const ctaSize = Math.round(fs * (h === "data_led" ? 0.38 : h === "brand_led" ? 0.48 : h === "founder_led" ? 0.5 : 0.46));
  blocks.push(ctaPill(brief.cta, ctaSize, ctaX, ctaFixedY ?? cursorY + m, accent).svg);

  // Founder attribution next to a non-hero headshot.
  if (
    brief.founder_name_usage.use &&
    brief.founder_name_usage.name &&
    headshotLayer &&
    h !== "founder_led"
  ) {
    const fs = Math.round(W * 0.022);
    blocks.push(
      `<text x="${headshotLayer.x + headshotLayer.d + Math.round(fs * 0.8)}" ` +
        `y="${headshotLayer.y + Math.round(headshotLayer.d / 2) + Math.round(fs * 0.35)}" ` +
        `font-family="${FONT_STACK}" font-size="${fs}" font-weight="600" ` +
        `fill="rgba(255,255,255,0.92)">${esc(brief.founder_name_usage.name)}</text>`,
    );
  }
  // founder_led: name under the hero portrait.
  if (brief.founder_name_usage.use && brief.founder_name_usage.name && headshotLayer && h === "founder_led") {
    const fs = Math.round(W * 0.024);
    blocks.push(
      `<text x="${headshotLayer.x + Math.round(headshotLayer.d / 2)}" ` +
        `y="${headshotLayer.y + headshotLayer.d + Math.round(fs * 1.4)}" text-anchor="middle" ` +
        `font-family="${FONT_STACK}" font-size="${fs}" font-weight="600" ` +
        `fill="rgba(255,255,255,0.92)">${esc(brief.founder_name_usage.name)}</text>`,
    );
  }

  // Expert credit (from the branding controls) — small line, bottom-left,
  // sitting just above the company wordmark when one is shown.
  if (brief.expert_name_usage.use && brief.expert_name_usage.name) {
    const efs = Math.round(W * 0.02);
    const wordmarkShown = brief.company_name_usage.use && !(brief.logo_usage.use && logo);
    const ey = wordmarkShown ? H - m - Math.round(efs * 1.9) : H - m;
    blocks.push(
      `<text x="${m}" y="${ey}" font-family="${FONT_STACK}" font-size="${efs}" ` +
        `font-weight="500" fill="rgba(255,255,255,0.8)">${esc("With " + brief.expert_name_usage.name)}</text>`,
    );
  }

  // Company wordmark when there's no logo to carry the name.
  if (brief.company_name_usage.use && !(brief.logo_usage.use && logo)) {
    const fs = Math.round(W * 0.026);
    blocks.push(
      `<text x="${m}" y="${H - m}" font-family="${FONT_STACK}" font-size="${fs}" ` +
        `font-weight="700" letter-spacing="2" fill="rgba(255,255,255,0.9)">${esc(
          input.brandName.toUpperCase(),
        )}</text>`,
    );
  }

  const typeLayer = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${blocks.join("")}</svg>`;
  layers.push({ input: Buffer.from(typeLayer), top: 0, left: 0 });

  // 5. Flatten.
  return sharp(bg).composite(layers).png().toBuffer();
}
