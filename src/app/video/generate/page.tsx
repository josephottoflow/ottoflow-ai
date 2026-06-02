/**
 * /video/generate — server entry point for the Video Pipeline.
 *
 * Loads the current user's READY brands so the picker shows immediately
 * without a client-side roundtrip. If ?brandId=X is provided (via deep
 * link from /brands/[id] topic cards), we also pre-fetch that brand's
 * topics so the topic picker shows real options on first paint.
 *
 * The actual UI + SSE + media playback lives in VideoGenerateClient.
 */
import {
  listReadyBrandsForUser,
  listTopicsForBrand,
} from "@/lib/db-video";
import { VideoGenerateClient } from "./VideoGenerateClient";

export const dynamic = "force-dynamic";

export default async function VideoGeneratePage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string; topicId?: string }>;
}) {
  const params = await searchParams;
  const brands = await listReadyBrandsForUser();

  // Choose the preselected brand: explicit query param > first ready brand.
  const preselectBrandId =
    params.brandId && brands.some((b) => b.id === params.brandId)
      ? params.brandId
      : null;

  const initialTopics = preselectBrandId
    ? await listTopicsForBrand(preselectBrandId)
    : [];

  // Topic preselect only valid if it actually belongs to the picked brand.
  const preselectTopicId =
    params.topicId && initialTopics.some((t) => t.id === params.topicId)
      ? params.topicId
      : null;

  return (
    <VideoGenerateClient
      brands={brands}
      initialTopics={initialTopics}
      preselectBrandId={preselectBrandId}
      preselectTopicId={preselectTopicId}
    />
  );
}
