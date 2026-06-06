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
import { execSync } from "node:child_process";
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

// ─── Phase 3 ops knobs ─────────────────────────────────────────────────────
// All env reads happen at module load; values are captured once. We read
// from process.env directly (not worker-env.ts) to avoid coupling this
// module to the validated env schema — keeps the helper unit-testable.
const RENDER_TIMEOUT_MS = Number(
  process.env.REMOTION_RENDER_TIMEOUT_MS ?? "300000",
);
const CHROME_EXEC_OVERRIDE =
  process.env.REMOTION_CHROME_EXECUTABLE?.trim() || undefined;

// ─── Chrome executable resolution (auto-discovery, 2026-06-06 fix) ──────────
// Remotion bundles a chrome-headless-shell binary in node_modules/.remotion,
// but on Railway/nixpacks that bundled binary cannot launch because it dynamic-
// links against libnspr4.so which isn't present in the nix profile. Production
// fails with: "error while loading shared libraries: libnspr4.so: cannot open
// shared object file" on every Remotion render.
//
// Fix: prefer the nix-installed chromium binary (already in nixpacks.toml's
// nixPkgs), which is fully linked against its own /nix/store libraries. We
// auto-discover via `which` rather than hard-coding a nix store path because
// store hashes change every time nixpacks rebuilds.
//
// Resolution order:
//   1. REMOTION_CHROME_EXECUTABLE env var (explicit override, wins)
//   2. `which chromium` (nix package name)
//   3. `which chromium-browser` (Debian/Ubuntu package name, safety net)
//   4. `which google-chrome` (third-party Chrome installs)
//   5. undefined → Remotion's bundled chrome-headless-shell (broken on Railway today)
//
// Resolution runs ONCE at module load. The result is logged so operators can
// see which binary the worker will use without needing to trigger a render.
function resolveChromiumExecutable(): string | undefined {
  if (CHROME_EXEC_OVERRIDE) return CHROME_EXEC_OVERRIDE;
  const candidates = ["chromium", "chromium-browser", "google-chrome"];
  for (const cmd of candidates) {
    try {
      const found = execSync(`which ${cmd}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (found) return found;
    } catch {
      // Not on PATH — try next candidate.
    }
  }
  return undefined;
}

const RESOLVED_CHROME_EXECUTABLE = resolveChromiumExecutable();

// Boot-time visibility — single line so it's grep-able in Railway logs.
console.log(
  `[remotion] chrome_executable resolved=${RESOLVED_CHROME_EXECUTABLE ?? "(none — falling back to Remotion bundled chrome-headless-shell)"} envOverride=${CHROME_EXEC_OVERRIDE ? "set" : "unset"}`,
);

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
    // 2026-06-06 — selectComposition spawns its own Chrome to evaluate
    // Root.tsx. Without browserExecutable here, it falls back to the
    // bundled chrome-headless-shell and fails on libnspr4.so. renderMedia
    // gets the same param below — both call sites must pass it.
    browserExecutable: RESOLVED_CHROME_EXECUTABLE ?? null,
    // chrome-for-testing makes Remotion pass --headless=new (new Chrome
    // headless mode). Required because nix-installed chromium 149+ removed
    // support for --headless=old. Default chromeMode "headless-shell" only
    // works against the bundled chrome-headless-shell binary, which we
    // explicitly bypassed via browserExecutable.
    chromeMode: "chrome-for-testing",
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
    // 2026-06-06 OOM mitigation — disable inter-scene fade transitions.
    // TransitionSeries with fade keeps TWO <OffthreadVideo> components in
    // memory during the overlap, which on small Railway replicas pushes
    // Chrome's compositor over the OOM threshold. Hard cuts between scenes
    // save ~150-200MB peak. Re-enable (0.4) once worker has 2GB+ RAM.
    transitionSec: 0,
  };

  // Phase 3.A — wrap renderMedia in a timeout race so a hung Chrome
  // process can't sit forever and waste BullMQ's stalled-job recovery
  // window. The timeout default is 5 min (env-tunable). On timeout we
  // throw a typed error so the caller (video-merge.ts) can attach
  // structured context for Sentry.
  const renderPromise = renderMedia({
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
    // Same H.264 + yuv420p the FFmpeg pipeline produced — downstream
    // audio mux stream-copies the video stream (no re-encode).
    pixelFormat: "yuv420p",
    onProgress: input.onProgress
      ? ({ progress }) => input.onProgress?.(progress)
      : undefined,
    // Phase 3.C — Chrome single-process keeps RAM use predictable on
    // Railway's small worker replicas. Without this, each render spawns
    // a parent + renderer + GPU process tree (1GB+ peak).
    chromiumOptions: {
      enableMultiProcessOnLinux: false,
      // swangle = software ANGLE backend. The hardware-accelerated default
      // ("angle") allocates GPU memory for textures even when no GPU is
      // present on the container. Swangle does all rasterization on CPU
      // with a much smaller VRAM-equivalent footprint. Performance trade-
      // off is real (~10-20% slower frames) but acceptable vs OOM crash.
      gl: "swangle",
    },
    // 2026-06-06 OOM mitigation — sequential ffmpeg encoding (no parallel
    // worker thread keeping a second frame buffer in memory).
    disallowParallelEncoding: true,
    // JPEG frames use ~40% less memory than the default PNG (no alpha
    // channel + lossy compression). For a video pipeline where the final
    // output is H.264 anyway, the quality delta is invisible.
    imageFormat: "jpeg",
    // Use the auto-discovered system chromium (nix-installed on Railway,
    // homebrew/apt on dev machines). Falls back to Remotion's bundled
    // chrome-headless-shell only when nothing else is found. See
    // resolveChromiumExecutable() above for resolution order + the libnspr4
    // bug that motivated the auto-discovery rewrite.
    browserExecutable: RESOLVED_CHROME_EXECUTABLE,
    // chrome-for-testing → Remotion passes --headless=new (modern Chrome
    // flag). Default "headless-shell" mode passes --headless=old which
    // modern Chromium binaries (nix package 149+) no longer support.
    chromeMode: "chrome-for-testing",
    // One Chromium per renderMedia call — worker-level concurrency caps
    // how many jobs run in parallel (videoMerge worker = 1 by default).
    concurrency: 1,
  });

  const timeoutHandle: { id?: NodeJS.Timeout } = {};
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle.id = setTimeout(() => {
      reject(
        new Error(
          `Remotion renderMedia exceeded ${RENDER_TIMEOUT_MS}ms timeout — Chrome may be hung or asset fetch stalled. Increase REMOTION_RENDER_TIMEOUT_MS if your videos legitimately need more time.`,
        ),
      );
    }, RENDER_TIMEOUT_MS);
    timeoutHandle.id.unref?.();
  });

  try {
    await Promise.race([renderPromise, timeoutPromise]);
  } finally {
    if (timeoutHandle.id) clearTimeout(timeoutHandle.id);
  }

  return {
    outputPath: input.outputPath,
    durationSec: totalSec,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
  };
}
