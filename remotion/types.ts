/**
 * Remotion composition schemas + inferred types.
 *
 * Pattern matches the root project (tiktok-product-video-factory/src/remotion/):
 * define the zod schema first, infer TS types from it. This keeps
 * <Composition schema={...}> + the component's FC<Props> in perfect sync,
 * which Remotion v4's TypeScript signatures require.
 *
 * Mirrors VideoMergeOverlay / VideoMergeScene from src/lib/queue.ts so
 * Phase 2 worker integration can hand its data here without translation.
 */
import { z } from "zod";

export const timelineSceneSchema = z.object({
  /** 1-based scene index, matches storyboard.scenes[].index */
  index: z.number().int(),
  /** Direct MP4 URL (Pexels CDN, Runway, Luma, etc) */
  url: z.string(),
  /** On-screen duration in seconds */
  durationSec: z.number(),
  /** Provider identifier — debug-only */
  provider: z.string().optional(),
});
export type TimelineScene = z.infer<typeof timelineSceneSchema>;

export const timelineOverlaySchema = z.object({
  /** ALL CAPS 1-3 word phrase */
  text: z.string(),
  /** Absolute seconds from video start */
  start: z.number(),
  /** Absolute seconds from video start */
  end: z.number(),
  /**
   * Scene index — drives position rotation
   * (top-third / center / lower-third / very-low / upper-middle) in
   * OverlayText.tsx. Undefined → legacy lower-third default.
   */
  sceneIndex: z.number().int().optional(),
});
export type TimelineOverlay = z.infer<typeof timelineOverlaySchema>;

export const brandColorsSchema = z.object({
  background: z.string().optional(),
  primary: z.string().optional(),
});
export type BrandColors = z.infer<typeof brandColorsSchema>;

export const multiSceneVideoSchema = z.object({
  scenes: z.array(timelineSceneSchema),
  overlays: z.array(timelineOverlaySchema),
  brandColors: brandColorsSchema.optional(),
  /**
   * Transition duration between scenes (seconds). 0 = hard cuts (matches
   * current FFmpeg concat demuxer behavior). 0.4s is a tasteful default
   * the existing pipeline doesn't support at all.
   */
  transitionSec: z.number().optional(),
});
export type MultiSceneVideoProps = z.infer<typeof multiSceneVideoSchema>;
