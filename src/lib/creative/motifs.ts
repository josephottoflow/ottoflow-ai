/**
 * Deterministic brand motif overlays (P4 Phase 2A).
 *
 * Each motif is a PURE function of (canvas, palette, scale, placement) → SVG.
 * No AI, no randomness, no network: the same brand pattern renders the same
 * motif forever, surviving regeneration. Geometry is fixed per family; only
 * the palette is injected. The compositor places the motif as a low-opacity
 * layer ABOVE the graded background and BELOW the scrim (z2), so it reads as a
 * brand texture, never as clutter over the headline.
 *
 * Families (one visual signature each):
 *   interlocking_hub — calm convergence to a center hub   (e.g. Basecamp)
 *   diagonal_bars    — precise 30° gradient bars           (e.g. Stripe)
 *   orbital_dots     — warm orbital growth                 (e.g. HubSpot)
 *   fine_grid        — exact fine lattice                  (e.g. Linear)
 *   mono_line        — minimal single continuous line      (e.g. Notion)
 */
import type { MotifFamily, MotifPlacement } from "./types";

export interface MotifOptions {
  family: MotifFamily;
  W: number;
  H: number;
  /** Palette hexes (already brand colors; fall back to neutral if absent). */
  primary: string;
  secondary: string;
  accent: string;
  /** 0..1 group opacity baked into the SVG (deterministic). */
  opacity: number;
  /** 0.1..2 motif scale relative to the canvas. */
  scale: number;
  placement: MotifPlacement;
}

/** Focal anchor for the motif based on placement. */
function focal(p: MotifPlacement, W: number, H: number): { cx: number; cy: number } {
  switch (p) {
    case "corner": return { cx: W * 0.82, cy: H * 0.82 };
    case "edge": return { cx: W, cy: H * 0.5 };
    case "full_tile": return { cx: W * 0.5, cy: H * 0.5 };
    case "center_bleed":
    default: return { cx: W * 0.5, cy: H * 0.5 };
  }
}

function interlockingHub(o: MotifOptions): string {
  const { cx, cy } = focal(o.placement, o.W, o.H);
  const r = Math.min(o.W, o.H) * 0.5 * o.scale;
  const rings = [0.35, 0.6, 0.85, 1.1].map(
    (k) => `<circle cx="${cx}" cy="${cy}" r="${(r * k).toFixed(1)}" fill="none" stroke="${o.accent}" stroke-width="${(r * 0.012).toFixed(1)}"/>`,
  );
  const spokes = [0, 60, 120, 180, 240, 300].map((deg) => {
    const a = (deg * Math.PI) / 180;
    const x2 = cx + Math.cos(a) * r * 1.1;
    const y2 = cy + Math.sin(a) * r * 1.1;
    return `<line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${o.secondary}" stroke-width="${(r * 0.01).toFixed(1)}"/>`;
  });
  const hub = `<circle cx="${cx}" cy="${cy}" r="${(r * 0.12).toFixed(1)}" fill="${o.accent}"/>`;
  return rings.join("") + spokes.join("") + hub;
}

function diagonalBars(o: MotifOptions): string {
  const gap = Math.max(24, o.W * 0.055) / o.scale;
  const sw = gap * 0.42;
  const bars: string[] = [];
  // 30° diagonals sweeping across the canvas.
  for (let x = -o.H; x < o.W + o.H; x += gap) {
    bars.push(
      `<line x1="${x.toFixed(1)}" y1="0" x2="${(x + o.H * 0.58).toFixed(1)}" y2="${o.H}" stroke="${o.accent}" stroke-width="${sw.toFixed(1)}"/>`,
    );
  }
  return `<g>${bars.join("")}</g>`;
}

function orbitalDots(o: MotifOptions): string {
  const cx = o.W * (o.placement === "corner" ? 0.78 : 0.62);
  const cy = o.H * 0.5;
  const base = Math.min(o.W, o.H) * 0.16 * o.scale;
  const dots: string[] = [];
  [1, 1.7, 2.5, 3.4].forEach((ring, ri) => {
    const r = base * ring;
    const n = 6 + ri * 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ri * 0.4;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      const dr = (base * 0.12) * (1 - ri * 0.12);
      dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dr.toFixed(1)}" fill="${ri % 2 ? o.secondary : o.accent}"/>`);
    }
  });
  return dots.join("");
}

function fineGrid(o: MotifOptions): string {
  const cell = Math.max(28, o.W * 0.05) / o.scale;
  const sw = Math.max(0.6, o.W * 0.0008);
  const lines: string[] = [];
  for (let x = 0; x <= o.W; x += cell) lines.push(`<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${o.H}" stroke="${o.accent}" stroke-width="${sw.toFixed(2)}"/>`);
  for (let y = 0; y <= o.H; y += cell) lines.push(`<line x1="0" y1="${y.toFixed(1)}" x2="${o.W}" y2="${y.toFixed(1)}" stroke="${o.accent}" stroke-width="${sw.toFixed(2)}"/>`);
  return `<g>${lines.join("")}</g>`;
}

function monoLine(o: MotifOptions): string {
  const { cx, cy } = focal(o.placement, o.W, o.H);
  const r = Math.min(o.W, o.H) * 0.42 * o.scale;
  const sw = Math.max(2, o.W * 0.004);
  // A single continuous looping curve — minimal, calm.
  const d =
    `M ${(cx - r).toFixed(1)} ${cy.toFixed(1)} ` +
    `C ${(cx - r).toFixed(1)} ${(cy - r).toFixed(1)}, ${(cx + r).toFixed(1)} ${(cy - r).toFixed(1)}, ${(cx + r).toFixed(1)} ${cy.toFixed(1)} ` +
    `C ${(cx + r).toFixed(1)} ${(cy + r).toFixed(1)}, ${(cx - r).toFixed(1)} ${(cy + r).toFixed(1)}, ${(cx - r).toFixed(1)} ${cy.toFixed(1)} Z`;
  return `<path d="${d}" fill="none" stroke="${o.accent}" stroke-width="${sw.toFixed(1)}"/>`;
}

const GEOMETRY: Record<MotifFamily, (o: MotifOptions) => string> = {
  interlocking_hub: interlockingHub,
  diagonal_bars: diagonalBars,
  orbital_dots: orbitalDots,
  fine_grid: fineGrid,
  mono_line: monoLine,
};

/**
 * Render the full motif SVG string. Group opacity is baked in (deterministic);
 * the compositor applies the blend mode when compositing the layer.
 */
export function renderMotifSvg(o: MotifOptions): string {
  const geo = GEOMETRY[o.family](o);
  const op = Math.max(0, Math.min(1, o.opacity));
  return (
    `<svg width="${o.W}" height="${o.H}" xmlns="http://www.w3.org/2000/svg">` +
    `<g opacity="${op}">${geo}</g></svg>`
  );
}
