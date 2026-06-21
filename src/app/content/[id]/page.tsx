import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { DbContentItem } from "@/lib/types";
import { ContentItemDetailClient } from "./ContentItemDetailClient";

export const dynamic = "force-dynamic";

export default async function ContentItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const sb = await createServerSupabaseClient();
  // RLS policy (migration 003) scopes by brand_id → brands.user_id, so a
  // non-owner gets back null rather than a typed row.
  const { data, error } = await sb
    .from("content_items")
    .select(
      "id, project_id, brand_id, user_prompt, platform, title, preview, body, status, created_at, engagement",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[content/[id]] fetch failed:", error.message);
    notFound();
  }
  if (!data) {
    notFound();
  }

  // Pull brand name for context if available — let the client guard against
  // missing values rather than failing the SSR.
  let brandName: string | null = null;
  if (data.brand_id) {
    const { data: brand } = await sb
      .from("brands")
      .select("name")
      .eq("id", data.brand_id)
      .maybeSingle();
    brandName = (brand?.name as string | undefined) ?? null;
  }

  // Video gating (Task 2): the AI-first video route requires this item's latest
  // creative brief to carry both visual_tension and visual_metaphor. Compute the
  // exact reason here so the button is never a dead, unexplained control.
  let videoDisabledReason: string | null = null;
  if (!data.brand_id) {
    videoDisabledReason = "Video needs a brand — this item has no brand attached.";
  } else {
    const { data: creative } = await sb
      .from("content_creatives")
      .select("creative_brief, created_at")
      .eq("content_item_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const brief = creative?.creative_brief as
      | { visual_tension?: string; visual_metaphor?: string }
      | undefined;
    if (!brief) {
      videoDisabledReason = "Generate the creative first — a video is built from its creative brief.";
    } else if (!brief.visual_tension || !brief.visual_metaphor) {
      videoDisabledReason = "Video generation requires visual_tension and visual_metaphor in the creative brief.";
    }
  }

  return (
    <ContentItemDetailClient
      item={data as DbContentItem}
      brandName={brandName}
      videoDisabledReason={videoDisabledReason}
    />
  );
}
