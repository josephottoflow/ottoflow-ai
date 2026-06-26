import { listBrands } from "@/lib/db-brands";
import { getContentItems } from "@/lib/db";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { VideoStartWizard, type WizardBrand, type WizardContent } from "./VideoStartWizard";

export const dynamic = "force-dynamic";

/**
 * /video/start — guided "Create a video" journey (Sprint 12).
 *
 * Server-loads the caller's brands + content items + which items are video-eligible
 * (a creative brief with visual_tension + visual_metaphor — the existing gate), then
 * renders the explicit Company → Content → Platform wizard. Read-only against existing
 * tables; no new API, no schema change. `?content=<id>` preselects (entered-from-content).
 */
export default async function VideoStartPage({
  searchParams,
}: {
  searchParams: Promise<{ content?: string }>;
}) {
  const sp = await searchParams;
  const preselectContentId = typeof sp?.content === "string" ? sp.content : null;

  const [brands, items] = await Promise.all([listBrands(), getContentItems()]);

  // Video-eligible content items: a creative brief carrying visual_tension + visual_metaphor.
  const eligible = new Set<string>();
  try {
    const sb = await createServerSupabaseClient();
    const { data } = await sb
      .from("content_creatives")
      .select("content_item_id")
      .not("creative_brief->>visual_tension", "is", null)
      .not("creative_brief->>visual_metaphor", "is", null)
      .neq("creative_brief->>visual_tension", "")
      .neq("creative_brief->>visual_metaphor", "");
    for (const r of data ?? []) {
      const id = (r as { content_item_id?: string }).content_item_id;
      if (id) eligible.add(id);
    }
  } catch (err) {
    console.error("[video/start] eligibility query failed:", err);
  }

  const counts: Record<string, number> = {};
  for (const it of items) if (it.brand_id) counts[it.brand_id] = (counts[it.brand_id] ?? 0) + 1;

  const wBrands: WizardBrand[] = brands.map((b) => ({
    id: b.id,
    name: b.name,
    industry: b.industry,
    logoUrl: b.logo_url ?? null,
    colors: b.brand_colors
      ? Object.values(b.brand_colors).filter((v): v is string => typeof v === "string" && v.startsWith("#"))
      : [],
    contentCount: counts[b.id] ?? 0,
  }));

  const wContent: WizardContent[] = items.map((it) => {
    const eng = it.engagement as { hashtags?: string[] } | null;
    return {
      id: it.id,
      brandId: it.brand_id ?? null,
      platform: it.platform,
      title: it.title,
      status: it.status,
      body: it.body ?? null,
      hashtags: eng && "hashtags" in eng ? eng.hashtags ?? [] : [],
      eligible: eligible.has(it.id),
    };
  });

  return <VideoStartWizard brands={wBrands} content={wContent} preselectContentId={preselectContentId} />;
}
