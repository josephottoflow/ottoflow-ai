import { createServerSupabaseClient } from "@/lib/supabase-server";
import { PublishingQueueClient, type PublishItem } from "./PublishingQueueClient";

export const dynamic = "force-dynamic";

/**
 * Publishing Queue (Publisher Foundation v1) — approved → scheduled →
 * published. Manual publishing in v1; RLS scopes to the signed-in user.
 */
export default async function PublishingQueuePage() {
  const sb = await createServerSupabaseClient();

  const [{ data: items }, { data: brands }, { data: latestMetrics }] = await Promise.all([
    sb
      .from("content_items")
      .select(
        "id, brand_id, platform, title, preview, body, status, engagement, scheduled_for, published_at, published_url, publishing_method, created_at",
      )
      .in("status", ["approved", "scheduled", "published"])
      .order("created_at", { ascending: false })
      .limit(200),
    sb.from("brands").select("id, name"),
    // Analytics v1 — latest snapshot per item (security_invoker view, mig 016).
    // Best-effort: pre-migration this select fails → metrics simply absent.
    sb.from("content_latest_metrics").select("*"),
  ]);

  const metricsByItem = new Map<string, Record<string, unknown>>(
    ((latestMetrics ?? []) as Array<Record<string, unknown>>).map((m) => [
      m.content_item_id as string,
      m,
    ]),
  );

  const brandNames = new Map<string, string>(
    (brands ?? []).map((b) => [b.id as string, b.name as string]),
  );

  const publishItems: PublishItem[] = (items ?? []).map((i) => ({
    id: i.id as string,
    brandName: i.brand_id ? (brandNames.get(i.brand_id as string) ?? null) : null,
    platform: (i.platform as string) ?? "unknown",
    title: (i.title as string) ?? "Untitled",
    preview: (i.preview as string | null) ?? null,
    body: (i.body as string | null) ?? null,
    status: i.status as string,
    hashtags: (i.engagement as { hashtags?: string[] } | null)?.hashtags ?? [],
    scheduledFor: (i.scheduled_for as string | null) ?? null,
    publishedAt: (i.published_at as string | null) ?? null,
    publishedUrl: (i.published_url as string | null) ?? null,
    publishingMethod: (i.publishing_method as string | null) ?? null,
    createdAt: i.created_at as string,
    metrics: (() => {
      const m = metricsByItem.get(i.id as string);
      if (!m) return null;
      return {
        impressions: (m.impressions as number | null) ?? null,
        likes: (m.likes as number | null) ?? null,
        comments: (m.comments as number | null) ?? null,
        shares: (m.shares as number | null) ?? null,
        engagementRate: (m.engagement_rate as number | null) ?? null,
        capturedAt: m.captured_at as string,
      };
    })(),
  }));

  return <PublishingQueueClient initialItems={publishItems} />;
}
