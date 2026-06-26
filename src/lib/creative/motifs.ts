/**
 * Brand "atmosphere" overlays (Sprint 18 — de-templating).
 *
 * REPLACES the former geometric motif system (bars / grids / orbital dots /
 * rings / mono-line). Each family now renders the brand palette as SOFT LIGHT —
 * radial glows, blooms and a gradient light-sweep — never geometric shapes.
 *
 * Pure function of (canvas, palette, scale, placement) → SVG; deterministic,
 * no AI, no network. The compositor places it BELOW the scrim with a `screen`
 * blend, so the brand colour becomes ambient light/atmosphere in the image
 * instead of decorating it with template graphics.
 *
 * The MotifOptions / MotifFamily contract is unchanged; the families are now
 * reinterpreted as light *signatures* rather than shapes (no compositor change).
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

/** Focal anchor for the light based on placement. */
function focal(p: MotifPlacement, W: number, H: number): { cx: number; cy: number } {
  switch (p) {
    case "corner": return { cx: W * 0.82, cy: H * 0.82 };
    case "edge": return { cx: W, cy: H * 0.5 };
    case "full_tile": return { cx: W * 0.5, cy: H * 0.5 };
    case "center_bleed":
    default: return { cx: W * 0.5, cy: H * 0.5 };
  }
}

/** A soft light source — rendered as a feathered radial glow (no hard edge). */
interface Light { x: number; y: number; r: number; color: string; alpha: number; }
interface Sweep { color: string; alpha: number; angle: number; }

/**
 * Per-family soft-light signature. Each family keeps its *character* (calm
 * convergence, energetic diagonal, warm orbits, etc.) but expresses it purely
 * as light placement — never geometry.
 */
function lightsFor(o: MotifOptions): { lights: Light[]; sweep?: Sweep } {
  const { W, H, secondary, accent, scale } = o;
  const f = focal(o.placement, W, H);
  const base = Math.min(W, H);
  switch (o.family) {
    case "interlocking_hub": // calm convergence → a single bloom of light at the hub
      return { lights: [
        { x: f.cx, y: f.cy, r: base * 0.75 * scale, color: accent, alpha: 1 },
        { x: f.cx, y: f.cy, r: base * 0.32 * scale, color: secondary, alpha: 0.7 },
      ] };
    case "diagonal_bars": // energetic → a soft diagonal light sweep + a hot corner
      return {
        lights: [{ x: W * 0.86, y: H * 0.16, r: base * 0.95 * scale, color: accent, alpha: 1 }],
        sweep: { color: secondary, alpha: 0.5, angle: 28 },
      };
    case "orbital_dots": // warm growth → soft out-of-focus bokeh orbs
      return { lights: [
        { x: W * 0.70, y: H * 0.40, r: base * 0.26 * scale, color: accent, alpha: 1 },
        { x: W * 0.52, y: H * 0.64, r: base * 0.18 * scale, color: secondary, alpha: 0.8 },
        { x: W * 0.85, y: H * 0.72, r: base * 0.14 * scale, color: accent, alpha: 0.7 },
      ] };
    case "fine_grid": // precise → replaced by clean ambient haze from two corners
      return { lights: [
        { x: W * 0.14, y: H * 0.12, r: base * 0.62 * scale, color: secondary, alpha: 0.7 },
        { x: W * 0.90, y: H * 0.90, r: base * 0.55 * scale, color: accent, alpha: 0.7 },
      ] };
    case "mono_line": // minimal → one quiet bloom
    default:
      return { lights: [{ x: f.cx, y: f.cy, r: base * 0.62 * scale, color: accent, alpha: 0.85 }] };
  }
}

/**
 * Render the brand-atmosphere SVG string. Group opacity is baked in
 * (deterministic); the compositor applies the `screen` blend so the colour
 * reads as light. No strokes, no shapes — only feathered gradient fills.
 */
export function renderMotifSvg(o: MotifOptions): string {
  const { lights, sweep } = lightsFor(o);
  const op = Math.max(0, Math.min(1, o.opacity));
  const defs: string[] = [];
  const fills: string[] = [];

  lights.forEach((l, i) => {
    const id = `glow${i}`;
    defs.push(
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${l.x.toFixed(1)}" cy="${l.y.toFixed(1)}" r="${Math.max(1, l.r).toFixed(1)}">` +
        `<stop offset="0%" stop-color="${l.color}" stop-opacity="${l.alpha.toFixed(2)}"/>` +
        `<stop offset="55%" stop-color="${l.color}" stop-opacity="${(l.alpha * 0.35).toFixed(2)}"/>` +
        `<stop offset="100%" stop-color="${l.color}" stop-opacity="0"/>` +
        `</radialGradient>`,
    );
    fills.push(`<rect width="${o.W}" height="${o.H}" fill="url(#${id})"/>`);
  });

  if (sweep) {
    defs.push(
      `<linearGradient id="sweep" gradientTransform="rotate(${sweep.angle})">` +
        `<stop offset="0%" stop-color="${sweep.color}" stop-opacity="0"/>` +
        `<stop offset="50%" stop-color="${sweep.color}" stop-opacity="${sweep.alpha.toFixed(2)}"/>` +
        `<stop offset="100%" stop-color="${sweep.color}" stop-opacity="0"/>` +
        `</linearGradient>`,
    );
    fills.push(`<rect width="${o.W}" height="${o.H}" fill="url(#sweep)"/>`);
  }

  return (
    `<svg width="${o.W}" height="${o.H}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>${defs.join("")}</defs>` +
    `<g opacity="${op}">${fills.join("")}</g></svg>`
  );
}
