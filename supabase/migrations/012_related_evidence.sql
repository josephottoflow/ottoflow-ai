-- 012_related_evidence.sql
-- V2 Phase 2B — Research Workspace. Read-only addition: semantic neighbors
-- for the Evidence Viewer's "Related evidence" panel. No table changes.
--
-- Given one evidence chunk, return the nearest chunks from OTHER sources of
-- the same brand (same-source siblings are excluded — the viewer already
-- shows them as the document's own chunks). SECURITY INVOKER: the seed-row
-- lookup runs under the caller's RLS, so users can only pivot from evidence
-- they can already read.

CREATE OR REPLACE FUNCTION related_research_documents(
  p_document_id UUID,
  p_match_count INT DEFAULT 6
)
RETURNS TABLE (
  id UUID,
  source_id UUID,
  source_type TEXT,
  url TEXT,
  domain TEXT,
  title TEXT,
  summary TEXT,
  content TEXT,
  captured_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT rd.id, rd.source_id, rd.source_type, rd.url, rd.domain, rd.title,
         rd.summary, rd.content, rd.captured_at,
         1 - (rd.embedding <=> src.embedding) AS similarity
  FROM research_documents src
  JOIN research_documents rd
    ON rd.brand_id = src.brand_id
   AND rd.id <> src.id
   AND (rd.source_id IS NULL OR src.source_id IS NULL OR rd.source_id <> src.source_id)
  WHERE src.id = p_document_id
    AND src.embedding IS NOT NULL
    AND rd.embedding IS NOT NULL
    AND rd.deleted_by_user = false
  ORDER BY rd.embedding <=> src.embedding
  LIMIT LEAST(p_match_count, 20);
$$;
