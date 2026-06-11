/**
 * Evidence persistence — V2 Phase 1 (the moat foundation).
 *
 * Research used to be lossy: Gemini read pages and search results, produced a
 * profile, and everything it read was discarded. This module makes research an
 * ACCUMULATING ASSET: every source is fetched/captured, chunked, hashed,
 * embedded, and stored in `research_documents` (migration 010).
 *
 * Design principles:
 *  - Best-effort everywhere: evidence storage must never fail a research run,
 *    and a failed embedding must never block a stored chunk (embedding is
 *    NULLable + backfillable).
 *  - Dedupe by content: (brand_id, content_hash) is unique — refreshing an
 *    unchanged site stores nothing new, but the caller still receives the
 *    existing row ids so grounding stays correct across runs.
 *  - No new infrastructure: runs inline in the worker, plain Supabase writes.
 */
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { embedTexts, EMBEDDING_MODEL } from "./gemini";

// ─── Types ───────────────────────────────────────────────────────────────────

export type EvidenceSourceType =
  | "website"
  | "search_result"
  | "competitor"
  | "industry"
  | "keyword"
  | "social"
  | "news"
  | "manual";

export interface EvidenceInput {
  sourceType: EvidenceSourceType;
  /** Original URL (may be a Google grounding redirect for search results). */
  url?: string | null;
  title?: string | null;
  /** Full text of the source — will be chunked. Required, non-empty. */
  content: string;
  metadata?: Record<string, unknown>;
}

export interface StoredSourceRef {
  /** Groups all chunks of one captured source (research_documents.source_id). */
  sourceId: string;
  url: string | null;
  /** Ids of NEWLY inserted chunks for this source (empty if fully deduped). */
  documentIds: string[];
}

export interface StoreEvidenceResult {
  /** ALL evidence row ids representing these sources (new + pre-existing dupes). */
  documentIds: string[];
  /** Per-source breakdown of newly inserted rows (for enrichment passes). */
  sources: StoredSourceRef[];
  sourcesCollected: number;
  chunksStored: number;   // newly inserted (post-dedupe)
  chunksEmbedded: number; // newly inserted with a non-null embedding
}

// ─── Chunking ────────────────────────────────────────────────────────────────
// Paragraph-aware sliding chunker. Targets ~1,500 chars (~350-400 tokens) so
// a chunk is small enough for precise retrieval but big enough to carry a
// complete thought. Hard cap prevents pathological single-paragraph pages.

const CHUNK_TARGET = 1_500;
const CHUNK_HARD_MAX = 2_200;
const CHUNK_MIN = 200; // tail chunks below this merge into the previous chunk

export function chunkText(raw: string): string[] {
  const text = raw.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!text) return [];
  if (text.length <= CHUNK_HARD_MAX) return [text];

  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const para of paragraphs) {
    if (para.length > CHUNK_HARD_MAX) {
      // Oversized paragraph: flush current, then hard-split on sentence-ish
      // boundaries.
      push();
      let rest = para;
      while (rest.length > CHUNK_HARD_MAX) {
        let cut = rest.lastIndexOf(". ", CHUNK_TARGET);
        if (cut < CHUNK_MIN) cut = CHUNK_TARGET;
        chunks.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 1);
      }
      current = rest;
      continue;
    }
    if (current.length + para.length + 2 > CHUNK_TARGET && current) push();
    current = current ? `${current}\n\n${para}` : para;
  }
  push();

  // Merge a tiny tail into its predecessor.
  if (chunks.length >= 2 && chunks[chunks.length - 1].length < CHUNK_MIN) {
    const tail = chunks.pop()!;
    chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}\n\n${tail}`;
  }
  return chunks;
}

// ─── Page fetching ───────────────────────────────────────────────────────────
// Plain fetch + tag-strip. Deliberately simple: no headless browser, no
// readability lib. JS-rendered SPAs degrade to whatever is in the HTML — the
// urlContext grounding (what Gemini itself read) still covers those.

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_TEXT_CHARS = 40_000;

export async function fetchPageText(
  url: string
): Promise<{ title: string | null; text: string } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; OttoflowResearch/1.0; +https://ottoflow.ai)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("html") && !ctype.includes("text/plain")) return null;

    let html = await res.text();
    if (html.length > MAX_HTML_BYTES) html = html.slice(0, MAX_HTML_BYTES);

    const title =
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim().slice(0, 300) ??
      null;

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      // Preserve document structure as markdown-ish markers — headings and
      // list items carry retrieval-relevant semantics that flat text loses.
      .replace(/<h[1-6][^>]*>/gi, "\n\n## ")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/[ \t]+/g, " ")
      // Empty list/heading markers from contentless tags are pure noise.
      .replace(/^\s*(?:-|##)\s*$/gm, "")
      .replace(/\n\s*\n\s*/g, "\n\n")
      .trim()
      .slice(0, MAX_TEXT_CHARS);

    if (text.length < 100) return null; // not meaningful evidence
    return { title, text };
  } catch {
    return null;
  }
}

// ─── Grounded-claim sanitation (Production Hardening v1, P0) ─────────────────
// Google Search grounding "snippets" are groundingSupports.segment.text —
// slices of the MODEL'S OWN structured-output JSON, not source text. The
// first production corpus showed 24% of stored chunks were raw JSON shards
// (`", "strengths": [` …). This cleaner turns a segment into readable claim
// text or rejects it outright; rejected sources are NOT stored as evidence.

export function sanitizeGroundedClaim(raw: string): string | null {
  let t = raw
    .replace(/[“”]/g, '"')
    // JSON key labels → drop
    .replace(/"[a-z_]{2,30}"\s*:\s*/gi, " ")
    // array element boundaries → sentence breaks
    .replace(/",\s*"/g, ". ")
    // structural characters → space
    .replace(/[{}[\]]/g, " ")
    .replace(/"/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim()
    // leading/trailing punctuation debris
    .replace(/^[\s.,;:]+|[\s,;:]+$/g, "");

  if (t.length < 80) return null; // too short to be evidence
  const alnum = (t.match(/[a-z0-9]/gi) ?? []).length;
  if (alnum / t.length < 0.7) return null; // punctuation-dominated shard
  return t.slice(0, 1500);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const DOMAIN_LIKE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;

/**
 * Google Search grounding URIs are opaque redirects through
 * vertexaisearch.cloud.google.com — useless as a domain signal. The grounding
 * chunk's `title` is usually the real domain; prefer it when the URL is a
 * redirect. (Source-quality scoring depends on real domains.)
 */
function effectiveDomain(url: string | null | undefined, title: string | null | undefined): string | null {
  const dom = domainOf(url);
  const isRedirect =
    dom === "vertexaisearch.cloud.google.com" || (url ?? "").includes("grounding-api-redirect");
  if (isRedirect && title && DOMAIN_LIKE.test(title.trim())) {
    return title.trim().replace(/^www\./, "").toLowerCase();
  }
  return dom;
}

function hashChunk(content: string): string {
  return createHash("sha256")
    .update(content.toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex");
}

// ─── Storage ─────────────────────────────────────────────────────────────────

/**
 * Chunk, embed, and persist a batch of evidence sources for a brand.
 * Never throws — returns zeroed counters on total failure (callers log via
 * their own channel; a research run must not die because evidence storage
 * hiccuped).
 */
export async function storeEvidence(
  admin: SupabaseClient,
  args: {
    brandId: string;
    runId: string | null;
    sources: EvidenceInput[];
  }
): Promise<StoreEvidenceResult> {
  const empty: StoreEvidenceResult = {
    documentIds: [],
    sources: [],
    sourcesCollected: 0,
    chunksStored: 0,
    chunksEmbedded: 0,
  };
  try {
    const usable = args.sources.filter((s) => s.content && s.content.trim().length > 0);
    if (usable.length === 0) return empty;

    // 1. Chunk every source. Each source gets a source_id grouping all of
    //    its chunks (parent-document retrieval: chunk hit → whole source).
    interface PendingRow {
      hash: string;
      sourceId: string;
      row: Record<string, unknown>;
    }
    const pending: PendingRow[] = [];
    const sourceRefs: StoredSourceRef[] = [];
    for (const src of usable) {
      const sourceId = randomUUID();
      sourceRefs.push({ sourceId, url: src.url ?? null, documentIds: [] });
      const chunks = chunkText(src.content);
      chunks.forEach((chunk, idx) => {
        pending.push({
          hash: hashChunk(chunk),
          sourceId,
          row: {
            brand_id: args.brandId,
            run_id: args.runId,
            source_id: sourceId,
            source_type: src.sourceType,
            url: src.url ?? null,
            domain: effectiveDomain(src.url, src.title),
            title: src.title ?? null,
            content: chunk,
            chunk_index: idx,
            content_hash: hashChunk(chunk),
            language: "en",
            metadata: src.metadata ?? {},
          },
        });
      });
    }
    if (pending.length === 0) return empty;

    // Drop intra-batch duplicates (e.g. same boilerplate on two pages).
    const seen = new Set<string>();
    const unique = pending.filter((p) => {
      if (seen.has(p.hash)) return false;
      seen.add(p.hash);
      return true;
    });

    // 2. Which hashes already exist for this brand? (cross-run dedupe)
    const allHashes = unique.map((p) => p.hash);
    const existing = new Map<string, string>(); // hash → id
    for (let i = 0; i < allHashes.length; i += 200) {
      const slice = allHashes.slice(i, i + 200);
      const { data } = await admin
        .from("research_documents")
        .select("id, content_hash")
        .eq("brand_id", args.brandId)
        .in("content_hash", slice);
      for (const row of data ?? []) {
        existing.set(row.content_hash as string, row.id as string);
      }
    }
    const fresh = unique.filter((p) => !existing.has(p.hash));

    // 3. Embed only the fresh chunks (best-effort; null on failure).
    const vectors = await embedTexts(fresh.map((p) => p.row.content as string));
    let embedded = 0;
    fresh.forEach((p, i) => {
      const v = vectors[i];
      if (v) {
        // pgvector via PostgREST accepts the '[...]' string literal form.
        p.row.embedding = JSON.stringify(v);
        p.row.embedding_model = EMBEDDING_MODEL;
        embedded++;
      }
    });

    // 4. Insert (ignoreDuplicates guards the race where two runs insert the
    //    same hash concurrently).
    const insertedIds: string[] = [];
    const refBySourceId = new Map(sourceRefs.map((r) => [r.sourceId, r]));
    for (let i = 0; i < fresh.length; i += 100) {
      const slice = fresh.slice(i, i + 100);
      const { data, error } = await admin
        .from("research_documents")
        .upsert(slice.map((p) => p.row), {
          onConflict: "brand_id,content_hash",
          ignoreDuplicates: true,
        })
        .select("id, source_id");
      if (error) {
        // Keep going — partial persistence beats none.
        continue;
      }
      for (const row of data ?? []) {
        insertedIds.push(row.id as string);
        refBySourceId.get(row.source_id as string)?.documentIds.push(row.id as string);
      }
    }

    return {
      documentIds: [...existing.values(), ...insertedIds],
      sources: sourceRefs,
      sourcesCollected: usable.length,
      chunksStored: insertedIds.length,
      chunksEmbedded: embedded,
    };
  } catch {
    return empty;
  }
}
