/**
 * /video/generate — LEGACY entry point, now permanently redirected.
 *
 * Sprint 37 (Priority 1 — one unified journey): the canonical "Create a video"
 * flow is the guided wizard at /video/start. Every in-app "Generate Video" CTA
 * already routes there; this page was an orphaned competing workflow reachable
 * only by direct URL / old bookmarks. We redirect (preserving brandId/topicId
 * deep-link params) so there is exactly ONE obvious way through the product.
 *
 * The old SSE client (VideoGenerateClient) and /api/generate route remain in the
 * tree but are no longer reachable from navigation — a later cleanup can remove
 * them once nothing depends on the SSE demo path.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function VideoGeneratePage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string; topicId?: string }>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (params.brandId) qs.set("brandId", params.brandId);
  if (params.topicId) qs.set("topicId", params.topicId);
  const query = qs.toString();
  redirect(`/video/start${query ? `?${query}` : ""}`);
}
