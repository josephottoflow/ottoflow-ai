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

  return (
    <ContentItemDetailClient
      item={data as DbContentItem}
      brandName={brandName}
    />
  );
}
