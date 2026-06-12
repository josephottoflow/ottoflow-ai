/**
 * GET /api/content/by-url?url=… — URL-based content lookup (Analytics v1)
 *
 * Finds the caller's published content_item whose published_url matches the
 * given URL (exact match after trimming trailing slash). Powers the
 * paste-a-link quick-entry on the analytics page. RLS-scoped via the
 * Clerk-authenticated client — no admin client needed for a read.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const raw = req.nextUrl.searchParams.get("url")?.trim();
  if (!raw || !/^https?:\/\//i.test(raw)) {
    return NextResponse.json({ error: "Provide a full http(s) URL." }, { status: 400 });
  }
  const normalized = raw.replace(/\/+$/, "");

  const sb = await createServerSupabaseClient();
  const { data: items } = await sb
    .from("content_items")
    .select("id, title, platform, brand_id, published_at, published_url")
    .eq("status", "published")
    .or(`published_url.eq.${normalized},published_url.eq.${normalized}/`)
    .limit(1);

  const item = items?.[0];
  if (!item) {
    return NextResponse.json(
      { error: "No published post found with that link. Add the link when marking published, or enter metrics from the Publishing queue." },
      { status: 404 },
    );
  }
  return NextResponse.json({ item });
}
