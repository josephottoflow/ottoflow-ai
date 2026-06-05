/**
 * ADR-001 Phase 1 spike runner.
 *
 * Bundles the Remotion entry at ../remotion/index.ts, selects the
 * MultiSceneVideo composition, and renders to ./spike-output.mp4.
 *
 * Two modes:
 *   1. Demo (default) — uses 4 hardcoded Pexels stock URLs + per-scene
 *      overlays defined in remotion/Root.tsx defaultProps. No env vars
 *      required. Renders ~24s of vertical video.
 *
 *      $ npx tsx scripts/remotion-spike.ts
 *
 *   2. Real (--job-id=<uuid>) — fetches the render_jobs row + its
 *      scene_generations rows from Supabase, builds the composition props
 *      from real data, renders to MP4. Requires:
 *        NEXT_PUBLIC_SUPABASE_URL
 *        SUPABASE_SERVICE_ROLE_KEY
 *
 *      $ npx tsx scripts/remotion-spike.ts --job-id=f992f108-a094-4f8c-ab4d-6cb2c598d827
 *
 * Output: ./spike-output.mp4 alongside this script's project root.
 * Compare against the merged-videos/<jobId>.mp4 in Supabase Storage to
 * decide whether Phase 2 worker integration is worth shipping.
 *
 * NOTE: This renders the SILENT visual track only. The Phase 2 worker
 * integration will pipe this output into the existing FFmpeg audio mux
 * step. For now you can manually compare visuals side-by-side with the
 * current merged output to make the decision.
 */
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
import type { MultiSceneVideoProps } from "../remotion/types";

// Always invoked from ottoflow-ai/ root (npx tsx scripts/remotion-spike.ts).
// Using process.cwd() avoids ESM-vs-CJS import.meta.url awkwardness with tsx.
const PROJECT_ROOT = process.cwd();

// ─── CLI args ─────────────────────────────────────────────────────────────
function parseArgs(): { jobId: string | null } {
  const jobIdArg = process.argv.find((a) => a.startsWith("--job-id="));
  return { jobId: jobIdArg ? jobIdArg.split("=")[1] : null };
}

// ─── Real-data mode: fetch render_jobs + scene_generations ────────────────
async function loadJobData(jobId: string): Promise<MultiSceneVideoProps> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Real-data mode requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.",
    );
  }

  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // 1. Pull the render_jobs row for storyboard + overlay_json
  const { data: job, error: jobErr } = await sb
    .from("render_jobs")
    .select("id, storyboard_json, overlay_json, output_url, video_attribution")
    .eq("id", jobId)
    .single();
  if (jobErr || !job) {
    throw new Error(`render_jobs ${jobId}: ${jobErr?.message ?? "not found"}`);
  }

  // 2. Pull successful scene_generations rows
  const { data: sceneRows, error: scenesErr } = await sb
    .from("scene_generations")
    .select("scene_number, clip_url, duration_sec, provider")
    .eq("render_job_id", jobId)
    .neq("provider", "failed")
    .order("scene_number", { ascending: true });
  if (scenesErr) {
    throw new Error(`scene_generations fetch: ${scenesErr.message}`);
  }

  // Build the scenes array. If scene_generations is empty (the silent-
  // fallback case), pad with the single output_url repeated across the
  // storyboard scene count.
  let scenes: MultiSceneVideoProps["scenes"];
  if (sceneRows && sceneRows.length > 0) {
    scenes = sceneRows
      .filter((r) => r.clip_url && r.duration_sec)
      .map((r) => ({
        index: r.scene_number as number,
        url: r.clip_url as string,
        durationSec: Number(r.duration_sec ?? 6),
        provider: (r.provider as string) ?? "unknown",
      }));
  } else {
    // No scene rows — fall back to repeating output_url for each storyboard scene
    const sb_scenes = (job.storyboard_json as {
      scenes?: { index: number; durationSec: number }[];
    } | null)?.scenes ?? [];
    if (!job.output_url || sb_scenes.length === 0) {
      throw new Error(
        "Job has no successful scenes AND no output_url — nothing to render",
      );
    }
    scenes = sb_scenes.map((s) => ({
      index: s.index,
      url: job.output_url as string,
      durationSec: Math.max(3, Math.min(10, s.durationSec)),
      provider: "pexels-fallback",
    }));
  }

  // Overlays from overlay_json.keywords (the per-scene flattened list)
  const overlayBundle = job.overlay_json as null | {
    keywords?: {
      text: string;
      start: number;
      end: number;
      sceneIndex?: number;
    }[];
  };
  const overlays = (overlayBundle?.keywords ?? []).map((k) => ({
    text: k.text,
    start: k.start,
    end: k.end,
    sceneIndex: k.sceneIndex,
  }));

  return { scenes, overlays, brandColors: undefined, transitionSec: 0.4 };
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const { jobId } = parseArgs();
  const entry = path.resolve(PROJECT_ROOT, "remotion", "index.ts");
  const out = path.resolve(PROJECT_ROOT, "spike-output.mp4");

  console.log("[spike] Mode:", jobId ? `real (job ${jobId})` : "demo");
  console.log("[spike] Entry:", entry);
  console.log("[spike] Output:", out);

  // Optional: load real data
  let inputProps: MultiSceneVideoProps | undefined;
  if (jobId) {
    console.log("[spike] Fetching render_jobs row + scene_generations…");
    inputProps = await loadJobData(jobId);
    console.log(
      `[spike] Loaded ${inputProps.scenes.length} scenes (${inputProps.scenes.map((s) => s.provider).join("/")}), ${inputProps.overlays.length} overlays`,
    );
  }

  console.log("[spike] Bundling Remotion…");
  const bundleStart = Date.now();
  const bundleLocation = await bundle({
    entryPoint: entry,
    onProgress: (p) => {
      process.stdout.write(`\r[bundle] ${p}% `);
    },
  });
  process.stdout.write(
    `\n[spike] Bundled in ${((Date.now() - bundleStart) / 1000).toFixed(1)}s\n`,
  );

  console.log("[spike] Selecting composition MultiSceneVideo…");
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "MultiSceneVideo",
    inputProps: inputProps as Record<string, unknown> | undefined,
  });
  console.log(
    `[spike] Composition: ${composition.durationInFrames} frames @ ${composition.fps}fps = ${(composition.durationInFrames / composition.fps).toFixed(1)}s, ${composition.width}x${composition.height}`,
  );

  console.log("[spike] Rendering…");
  const renderStart = Date.now();
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: out,
    inputProps: inputProps as Record<string, unknown> | undefined,
    onProgress: ({ progress, renderedFrames, encodedFrames }) => {
      process.stdout.write(
        `\r[render] ${Math.round(progress * 100)}%  rendered=${renderedFrames} encoded=${encodedFrames}  `,
      );
    },
  });
  process.stdout.write(
    `\n[spike] Rendered in ${((Date.now() - renderStart) / 1000).toFixed(1)}s\n`,
  );

  console.log(`[spike] ✅ DONE — ${out}`);
  console.log("");
  console.log(
    "[spike] NOTE: this is the SILENT visual stream. The Phase 2 worker",
  );
  console.log(
    "[spike] integration will mux narration + ducked music via the existing",
  );
  console.log(
    "[spike] ffmpeg command in worker/processors/video-merge.ts. For the",
  );
  console.log(
    "[spike] decision gate, compare these visuals to the merged output:",
  );
  if (jobId) {
    console.log(
      `[spike]   https://ddozknywcdpyfdokmfrp.supabase.co/storage/v1/object/public/merged-videos/<userId>/${jobId}.mp4`,
    );
  } else {
    console.log("[spike]   (demo mode — no DB counterpart to compare)");
  }
}

main().catch((err) => {
  console.error("\n[spike] FAILED:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack.split("\n").slice(0, 5).join("\n"));
  }
  process.exit(1);
});
