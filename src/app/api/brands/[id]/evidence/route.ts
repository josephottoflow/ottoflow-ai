/**
 * GET /api/brands/[id]/evidence — Research Workspace detail fetches (Phase 2B)
 *
 * Two modes (one of):
 *   ?source=<sourceId>   Evidence Viewer: full chunk text for one captured
 *                        source (ordered by chunk_index) + semantically
 *                        related evidence from other sources (RPC, mig 012).
 *   ?ids=a,b,c           Grounding Inspector: evidence docs by id (≤24) for
 *                        an artifact's grounded_on array.
 *
 * Read-only. Uses the Clerk-authenticated Supabase client, so RLS scopes
 * every query to the caller's own brands — no admin client, no explicit
 * ownership checks needed.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { captureFallback } from "@/lib/observability";

export const runtime = "nodejs";
export const maxDuration = 30;

const DOC_FIELDS =
  "id, source_id, source_type, url, domain, title, summary, entities, keywords, content, chunk_index, captured_at";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: brandId } = await params;
  const sourceId = req.nextUrl.searchParams.get("source");
  const idsParam = req.nextUrl.searchParams.get("ids");

  if (!brandId || (!sourceId && !idsParam)) {
    return NextResponse.json(
      { error: "Provide ?source=<sourceId> or ?ids=<id,id,…>" },
      { status: 400 },
    );
  }

  try {
    const sb = await createServerSupabaseClient();

    // ── Mode 1: viewer — chunks of one source + related evidence ────────────
    if (sourceId) {
      const { data: chunks, error } = await sb
        .from("research_documents")
        .select(DOC_FIELDS)
        .eq("brand_id", brandId)
        .eq("source_id", sourceId)
        .eq("deleted_by_user", false)
        .order("chunk_index", { ascending: true })
        .limit(60);
      if (error) {
        captureFallback("evidence.chunks_failed", error, { brandId, sourceId });
        return NextResponse.json({ error: "Failed to load evidence" }, { status: 500 });
      }
      if (!chunks || chunks.length === 0) {
        return NextResponse.json({ chunks: [], related: [] });
      }

      // Related: pivot on the first chunk (RPC excludes same-source siblings;
      // returns [] when embeddings are missing).
      const { data: related, error: relErr } = await sb.rpc(
        "related_research_documents",
        { p_document_id: chunks[0].id, p_match_count: 6 },
      );
      if (relErr) {
        // Non-fatal — viewer still works without the related panel.
        captureFallback("evidence.related_failed", relErr, { brandId, sourceId });
      }
      return NextResponse.json({ chunks, related: related ?? [] });
    }

    // ── Mode 2: grounding inspector — docs by id ────────────────────────────
    const ids = (idsParam ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
      .slice(0, 24);
    if (ids.length === 0) {
      return NextResponse.json({ docs: [] });
    }
    const { data: docs, error } = await sb
      .from("research_documents")
      .select(DOC_FIELDS)
      .eq("brand_id", brandId)
      .in("id", ids);
    if (error) {
      captureFallback("evidence.by_ids_failed", error, { brandId });
      return NextResponse.json({ error: "Failed to load evidence" }, { status: 500 });
    }
    return NextResponse.json({ docs: docs ?? [] });
  } catch (err) {
    captureFallback("evidence.route_threw", err, { brandId });
    return NextResponse.json({ error: "Failed to load evidence" }, { status: 500 });
  }
}
