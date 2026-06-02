/**
 * /video/history — Phase 7 video generation history.
 *
 * Lists the current user's past video generations from render_jobs,
 * pulled via the RLS-scoped Supabase client. Each row carries the brand
 * + topic context, generated artifacts (script/storyboard/seo/overlays),
 * and the merged download URL when ready.
 *
 * Server-rendered for first paint; client component handles the UI.
 */
import Link from "next/link";
import { listUserVideoGenerations } from "@/lib/db-video";
import { getBrand } from "@/lib/db-brands";
import { VideoHistoryClient } from "./VideoHistoryClient";

export const dynamic = "force-dynamic";

export default async function VideoHistoryPage() {
  const jobs = await listUserVideoGenerations({ limit: 100 });

  // Hydrate brand names for the rows that have a brand_id. Single Promise.all
  // pull keeps the page's first-paint snappy. Dedup so we don't pay for the
  // same brand twice.
  const brandIds = Array.from(
    new Set(jobs.map((j) => j.brand_id).filter((x): x is string => !!x)),
  );
  const brandMap = new Map<string, { id: string; name: string }>();
  await Promise.all(
    brandIds.map(async (id) => {
      const b = await getBrand(id);
      if (b) brandMap.set(b.id, { id: b.id, name: b.name });
    }),
  );

  return (
    <VideoHistoryClient
      jobs={jobs}
      brandLookup={Object.fromEntries(brandMap.entries())}
    />
  );
}
