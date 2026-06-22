import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Quick Start → Generate Video resolver. Discoverability only — sends the user
 * to the EXISTING content-item Generate Video section (Content Item → Creative
 * Brief → Generate Video → Strategy → Seedance → Compose → MP4). No new
 * workflow, no topic→video shortcut, no backend touched.
 *
 * Eligible = the most recent content item whose latest creative brief carries
 * visual_tension + visual_metaphor (the exact gate the Generate Video button
 * uses; see app/content/[id]/page.tsx). RLS scopes the query to the caller's
 * own brands. Any failure routes safely to /content.
 *
 * NOTE: redirect() throws NEXT_REDIRECT internally, so it is called OUTSIDE the
 * try/catch — never let the catch swallow the redirect.
 */
export default async function VideoStartPage() {
  let target = "/content?needsVideoContent=1";
  try {
    const sb = await createServerSupabaseClient();
    const { data, error } = await sb
      .from("content_creatives")
      .select("content_item_id, created_at")
      .not("creative_brief->>visual_tension", "is", null)
      .not("creative_brief->>visual_metaphor", "is", null)
      .neq("creative_brief->>visual_tension", "")
      .neq("creative_brief->>visual_metaphor", "")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data?.content_item_id) {
      target = `/content/${data.content_item_id}#generate-video`;
    }
  } catch (err) {
    console.error("[video/start] resolver failed, routing to /content:", err);
    target = "/content";
  }
  redirect(target);
}
