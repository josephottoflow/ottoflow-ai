import { createServerSupabaseClient } from "@/lib/supabase-server";
import { ReviewQueueClient, type ReviewItem } from "./ReviewQueueClient";

export const dynamic = "force-dynamic";

/**
 * Review Queue (V2 Phase 2, first slice) — the single place to review
 * generated assets. RLS scopes everything to the signed-in user.
 */
export default async function ReviewQueuePage() {
  const sb = await createServerSupabaseClient();

  const [{ data: items }, { data: brands }] = await Promise.all([
    sb
      .from("content_items")
      .select(
        "id, brand_id, platform, title, preview, body, status, engagement, review_note, reviewed_at, created_at, grounded_on, topic_id",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    sb.from("brands").select("id, name"),
  ]);

  const brandNames = new Map<string, string>(
    (brands ?? []).map((b) => [b.id as string, b.name as string]),
  );

  const reviewItems: ReviewItem[] = (items ?? []).map((i) => ({
    id: i.id as string,
    brandName: i.brand_id ? (brandNames.get(i.brand_id as string) ?? null) : null,
    platform: (i.platform as string) ?? "unknown",
    title: (i.title as string) ?? "Untitled",
    preview: (i.preview as string | null) ?? null,
    body: (i.body as string | null) ?? null,
    status: i.status as string,
    hashtags:
      (i.engagement as { hashtags?: string[] } | null)?.hashtags ?? [],
    reviewNote: (i.review_note as string | null) ?? null,
    reviewedAt: (i.reviewed_at as string | null) ?? null,
    createdAt: i.created_at as string,
    evidenceCount: ((i.grounded_on as string[] | null) ?? []).length,
  }));

  return <ReviewQueueClient initialItems={reviewItems} />;
}
