/**
 * POST /api/brands/[id]/ask — Ask-the-Research (V2 Phase 2A)
 *
 * Grounded Q&A over the brand's evidence store (research_documents,
 * migration 010/011). Pipeline, all synchronous (no worker, no queue):
 *
 *   1. Auth + brand ownership + rate limit
 *   2. embedQuery(question)                      → 768-dim query vector
 *   3. search_research_documents_hybrid RPC      → vector+FTS RRF top-k
 *   4. answerFromEvidence (Gemini, strict-cite)  → markdown + [n] citations
 *   5. Map citations back to research_documents  → source viewer payload
 *
 * Deliberate scope cuts (Phase 2A): no conversation persistence, no
 * multi-turn memory, no parent-document expansion — single Q → grounded A.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";
import { captureFallback } from "@/lib/observability";
import {
  embedQuery,
  answerFromEvidence,
  type EvidenceForAnswer,
} from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60; // embed (~1s) + RPC (~ms) + Gemini answer (~3-8s)

const RATE_LIMIT = { limit: 30, windowSeconds: 60 * 60 } as const; // 30/hour
const ROUTE = "POST:/api/brands/[id]/ask";
const RETRIEVAL_K = 12;

const AskSchema = z.object({
  question: z.string().min(3).max(500),
});

interface RetrievedDoc {
  id: string;
  source_id: string | null;
  source_type: string;
  url: string | null;
  title: string | null;
  content: string;
  captured_at: string;
  score: number;
}

export interface AskSource {
  n: number;
  id: string;
  sourceType: string;
  url: string | null;
  domain: string | null;
  title: string | null;
  capturedAt: string;
  /** Full chunk text — the source evidence viewer renders this. */
  content: string;
  cited: boolean;
}

export interface AskResponse {
  answer: string;
  insufficient: boolean;
  sources: AskSource[];
  evidenceCount: number;
}

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: brandId } = await params;
  if (!brandId) {
    return NextResponse.json({ error: "Missing brand id" }, { status: 400 });
  }

  const rl = await rateLimit({
    key: `${ROUTE}:${userId}`,
    limit: RATE_LIMIT.limit,
    windowSeconds: RATE_LIMIT.windowSeconds,
  });
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "Too many questions in the last hour. Slow down.",
        retryAfterSeconds: rl.retryAfterSeconds,
      },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = AskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Question must be 3-500 characters." },
      { status: 400 },
    );
  }
  const question = parsed.data.question.trim();

  const admin = createAdminClient();

  // Ownership guard (admin client bypasses RLS, so check explicitly).
  const { data: brand, error: brandErr } = await admin
    .from("brands")
    .select("id, user_id, name, industry")
    .eq("id", brandId)
    .single();
  if (brandErr || !brand) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }
  if (brand.user_id !== userId) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  // Empty-evidence fast path: brands researched before the evidence layer
  // shipped have nothing to retrieve. Tell the user honestly.
  const { count: evidenceCount } = await admin
    .from("research_documents")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brandId)
    .eq("deleted_by_user", false);
  if (!evidenceCount || evidenceCount === 0) {
    const resp: AskResponse = {
      answer:
        "No research evidence is stored for this brand yet. Evidence accumulates automatically the next time brand research runs — re-run research and ask again.",
      insufficient: true,
      sources: [],
      evidenceCount: 0,
    };
    return NextResponse.json(resp);
  }

  // 1. Embed the question.
  const queryVector = await embedQuery(question);
  if (!queryVector) {
    return NextResponse.json(
      { error: "Embedding service unavailable — try again in a moment." },
      { status: 503 },
    );
  }

  // 2. Hybrid retrieval (vector + FTS, RRF-merged in SQL — migration 011).
  const { data: docs, error: rpcErr } = await admin.rpc(
    "search_research_documents_hybrid",
    {
      p_brand_id: brandId,
      p_query_text: question,
      p_query: JSON.stringify(queryVector),
      p_match_count: RETRIEVAL_K,
    },
  );
  if (rpcErr) {
    captureFallback("ask.retrieval_failed", rpcErr, { brandId });
    return NextResponse.json(
      { error: "Retrieval failed — try again." },
      { status: 500 },
    );
  }
  const retrieved = (docs ?? []) as RetrievedDoc[];

  if (retrieved.length === 0) {
    const resp: AskResponse = {
      answer:
        "Nothing in the stored research matches this question. Try rephrasing, or re-run research to collect fresh evidence.",
      insufficient: true,
      sources: [],
      evidenceCount,
    };
    return NextResponse.json(resp);
  }

  // 3. Grounded answer.
  const evidence: EvidenceForAnswer[] = retrieved.map((d, i) => ({
    n: i + 1,
    sourceType: d.source_type,
    title: d.title,
    domain: domainOf(d.url),
    capturedAt: d.captured_at,
    content: d.content.slice(0, 1800),
  }));

  try {
    const { data: result } = await answerFromEvidence({
      brandName: brand.name as string,
      industry: (brand.industry as string | null) ?? null,
      question,
      evidence,
    });

    const citedSet = new Set(result.cited.filter((n) => n >= 1 && n <= retrieved.length));
    const sources: AskSource[] = retrieved.map((d, i) => ({
      n: i + 1,
      id: d.id,
      sourceType: d.source_type,
      url: d.url,
      domain: domainOf(d.url),
      title: d.title,
      capturedAt: d.captured_at,
      content: d.content,
      cited: citedSet.has(i + 1),
    }));
    // Cited sources first, preserving citation order; uncited follow.
    sources.sort((a, b) => Number(b.cited) - Number(a.cited) || a.n - b.n);

    const resp: AskResponse = {
      answer: result.answer,
      insufficient: result.insufficient,
      sources,
      evidenceCount,
    };
    return NextResponse.json(resp);
  } catch (err) {
    captureFallback("ask.answer_failed", err, { brandId });
    return NextResponse.json(
      { error: "Answer generation failed — try again." },
      { status: 502 },
    );
  }
}
