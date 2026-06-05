/**
 * Remotion render helper for the video-merge worker.
 *
 * Encapsulates everything Remotion-specific so worker/processors/video-merge.ts
 * stays focused on its job (orchestration, audio mux, Storage upload). Two
 * exported functions:
 *
 *   - getBundleUrl()      idempotent bundle cache. First call compiles
 *                          remotion/index.ts → serve URL; subsequent calls
 *                          return the cached URL. Survives worker restarts
 *                          via $REMOTION_BUNDLE_DIR (default: /tmp).
 *
 *   - renderSilentVideo() takes {scenes, overlays, outputPath, onProgress}
 *                          → produces a silent H.264 MP4 with all scenes
 *                          composed via <TransitionSeries> + per-scene
 *                          overlays. The existing ffmpeg audio mux runs
 *                          on this output (stream-copy, no re-encode).
 *
 * Why no audio in this step:
 *   Remotion CAN bake audio via <Audio> components, but our narration is
 *   a data URL + music is a remote MP3 that needs ducking. Both are
 *   already wired through ffmpeg in video-merge.ts. Keeping the audio
 *   path in ffmpeg = less code change, smaller blast radius, and we get
 *   ffmpeg's proven amix=duration=first behavior for free.
 */
import path from "node:path";
import { tmpdir } from "node:os";
import { promises as fs } from "node:fs";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
import type {
  MultiSceneVideoProps,
  TimelineOverlay,
  TimelineScene,
} from "../remotion/types";

// ─── Module-scope cache ────────────────────────────────────────────────────
// First call to getBundleUrl pays the bundle cost (~4-5s). Every render
// thereafter reuses the URL.
let cachedBundlePromise: Promise<string> | null = null;
let cachedComposition: Awaited<ReturnType<typeof selectComposition>> | null = null;

export async function getBundleUrl(): Promise<string> {
  if (cachedBundlePromise) return cachedBundlePromise;
  // Use a stable cache directory so subsequent worker boots (e.g. after a
  // Railway redeploy of THIS commit) reuse the same compiled bundle.
  // /tmp on Railway is ephemeral per-container so this gives us per-boot
  // caching, not cross-boot — acceptable for the spike → Phase 2 flow.
  const cacheRoot = process.env.REMOTION_BUNDLE_DIR ?? path.join(tmpdir(), "remotion-bundle");
  await fs.mkdir(cacheRoot, { recursive: true });
  // The remotion entry lives at <projectRoot>/remotion/index.ts. The
  // worker bundle (worker/dist/index.js) runs from <projectRoot> at
  // runtime so we resolve relative to process.cwd().
  const entry = path.resolve(process.cwd(), "remotion", "index.ts");
  cachedBundlePromise = bundle({
    entryPoint: entry,
    outDir: cacheRoot,
    // No onProgress here — bundle is fast enough that the worker log
    // line spam isn't worth the noise.
  });
  return cachedBundlePromise;
}

// ─── Composition cache ─────────────────────────────────────────────────────
// selectComposition's network behavior is heavier than it looks — it spins
// up Chrome, navigates to the bundle URL, evaluates Root.tsx. Cache the
// result so subsequent renders skip the boot.
async function getComposition(): Promise<NonNullable<typeof cachedComposition>> {
  if (cachedComposition) return cachedComposition;
  const serveUrl = await getBundleUrl();
  cachedComposition = await selectComposition({
    serveUrl,
    id: "MultiSceneVideo",
  });
  return cachedComposition;
}

// ─── Main entry: render a silent multi-scene MP4 ───────────────────────────
export interface RenderSilentInput {
  scenes: TimelineScene[];
  overlays: TimelineOverlay[];
  outputPath: string;
  /** Called with 0..1 progress as Remotion encodes frames. */
  onProgress?: (progress: number) => void;
}

export interface RenderSilentResult {
  outputPath: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
}

export async function renderSilentVideo(
  input: RenderSilentInput,
): Promise<RenderSilentResult> {
  if (input.scenes.length === 0) {
    throw new Error("renderSilentVideo: scenes[] is empty — nothing to render");
  }

  const serveUrl = await getBundleUrl();
  const composition = await getComposition();

  // Compute the actual duration FROM PROPS instead of the cached default.
  // calculateMetadata in Root.tsx already does this, but selectComposition
  // resolves it with the default props. We pass real inputProps below so
  // renderMedia gets the right per-job duration.
  const totalSec = input.scenes.reduce((acc, s) => acc + s.durationSec, 0);
  const durationInFrames = Math.max(1, Math.round(totalSec * composition.fps));

  const props: MultiSceneVideoProps = {
    scenes: input.scenes,
    overlays: input.overlays,
    brandColors: undefined,
    transitionSec: 0.4,
  };

  await renderMedia({
    composition: {
      ...composition,
      // Override durationInFrames to match the actual scene durations for
      // THIS job, not the default-props demo data baked into selectComposition.
      durationInFrames,
    },
    serveUrl,
    codec: "h264",
    outputLocation: input.outputPath,
    inputProps: props as Record<string, unknown>,
    // Match what video-merge.ts:587 currently uses for the drawtext re-encode.
    // The downstream ffmpeg audio mux runs -c:v copy so we don't pay this
    // re-encode cost twice.
    pixelFormat: "yuv420p",
    onProgress: input.onProgress
      ? ({ progress }) => input.onProgress?.(progress)
      : undefined,
    // Keep Chromium concurrency at 1 — the worker already has CONCURRENCY=2
    // for parallel jobs; running 2 Chromes per job would OOM Railway.
    concurrency: 1,
  });

  return {
    outputPath: input.outputPath,
    durationSec: totalSec,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
  };
}
