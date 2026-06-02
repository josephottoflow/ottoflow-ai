/**
 * /video/[jobId] — generation detail view.
 *
 * Server-fetches the render_job row + all attached scene_generations via
 * the RLS-scoped Supabase client. Renders:
 *   - Final video player (merged URL when ready, scene-zero URL otherwise)
 *   - Script (hook + body + CTA from script_json)
 *   - Storyboard (scenes with shotType + duration + visual hint)
 *   - Per-scene cards (provider used, generation time, cost, fallback
 *     reason if any, attribution)
 *   - Keyword overlay timeline (from overlay_json)
 *   - SEO copy (title + description + hashtag chips)
 *
 * If the user doesn't own this render_job, RLS returns null → notFound().
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getVideoGeneration } from "@/lib/db-video";
import { getBrand } from "@/lib/db-brands";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { VideoDetailClient } from "./VideoDetailClient";
import type { DbSceneGeneration } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function VideoDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;

  const job = await getVideoGeneration(jobId);
  if (!job) notFound();

  // Brand hydration — best-effort (we never block the detail view on it).
  const brand = job.brand_id ? await getBrand(job.brand_id) : null;

  // Per-scene rows — RLS-scoped via the same Supabase client used for jobs.
  const sb = await createServerSupabaseClient();
  const { data: sceneRows } = await sb
    .from("scene_generations")
    .select("*")
    .eq("render_job_id", jobId)
    .order("scene_number", { ascending: true });
  const scenes = (sceneRows ?? []) as DbSceneGeneration[];

  return (
    <VideoDetailClient
      job={job}
      brand={brand ? { id: brand.id, name: brand.name } : null}
      scenes={scenes}
    />
  );
}
