-- 011_evidence_hardening.sql
-- V2 Phase 1.5 — intelligence-layer review fixes. ALL CHANGES ADDITIVE;
-- existing rows are preserved untouched.
--
-- Rationale: columns can be added any time, but data not captured at write
-- time is unrecoverable. This migration closes every write-time leak found
-- in the Phase 1.5 review BEFORE production evidence accumulates:
--   1. source_id    — chunks couldn't be grouped back into their parent
--                     source (parent-document retrieval for RAG).
--   2. language     — multilingual brands would silently poison the
--                     'english' FTS index with no way to filter.
--   3. content_items.topic_id — post→idea lineage existed only inside the
--                     prompt text; performance attribution for posts was
--                     structurally broken (videos already had topic_id).
--   4. competitors.grounded_on — competitor claims had no evidence link.
--   5. brand_intelligence_versions — re-research DESTROYED the previous
--                     profile + citations; brand memory needs history.
--   6. GIN indexes on grounded_on — "which artifacts cite this evidence"
--                     is the attribution query; arrays were unindexed.
--   7. Hybrid retrieval RPC — vector-only retrieval misses exact-term
--                     queries (names, prices, jargon); RRF-merge with FTS.

-- ─── 1+2. research_documents: parent grouping + language ─────────────────────
ALTER TABLE research_documents ADD COLUMN IF NOT EXISTS source_id UUID;
ALTER TABLE research_documents ADD COLUMN IF NOT EXISTS language  TEXT NOT NULL DEFAULT 'en';

CREATE INDEX IF NOT EXISTS research_documents_source_id_idx
  ON research_documents(source_id);

-- ─── 3. content_items: idea lineage ──────────────────────────────────────────
ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES brand_topics(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS content_items_topic_id_idx ON content_items(topic_id);

-- ─── 4. competitors: evidence linkage ────────────────────────────────────────
ALTER TABLE competitors ADD COLUMN IF NOT EXISTS grounded_on UUID[] NOT NULL DEFAULT '{}';

-- ─── 5. Brand intelligence version history ───────────────────────────────────
-- One snapshot per profile rewrite. brands.profile stays the "current" view;
-- this table is the memory. source distinguishes how the version came to be
-- (research run today; user_edit / optimizer-proposed diffs later).
CREATE TABLE IF NOT EXISTS brand_intelligence_versions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id   UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  run_id     UUID REFERENCES research_runs(id) ON DELETE SET NULL,
  profile    JSONB NOT NULL,
  citations  JSONB NOT NULL DEFAULT '{}',
  source     TEXT NOT NULL DEFAULT 'research',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT biv_source_check CHECK (source IN ('research','user_edit','optimizer')),
  CONSTRAINT biv_brand_version_uniq UNIQUE (brand_id, version)
);

ALTER TABLE brand_intelligence_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "biv_owner_select" ON brand_intelligence_versions;
CREATE POLICY "biv_owner_select"
  ON brand_intelligence_versions FOR SELECT
  USING (
    brand_id IN (
      SELECT id FROM brands WHERE user_id = current_clerk_user_id()
    )
  );

-- ─── 6. Attribution indexes ──────────────────────────────────────────────────
-- "Which artifacts were grounded on evidence doc X?" — the core attribution
-- query — needs GIN over the uuid[] columns.
CREATE INDEX IF NOT EXISTS brand_topics_grounded_on_idx  ON brand_topics  USING gin (grounded_on);
CREATE INDEX IF NOT EXISTS content_items_grounded_on_idx ON content_items USING gin (grounded_on);
CREATE INDEX IF NOT EXISTS render_jobs_grounded_on_idx   ON render_jobs   USING gin (grounded_on);

-- ─── 7. Hybrid retrieval (vector + FTS, reciprocal-rank fusion) ─────────────
-- Vector-only retrieval misses exact terms (competitor names, prices,
-- product jargon); FTS-only misses paraphrase. RRF (k=60) merges both rank
-- lists without score-calibration headaches. SECURITY INVOKER → RLS applies.
CREATE OR REPLACE FUNCTION search_research_documents_hybrid(
  p_brand_id     UUID,
  p_query_text   TEXT,
  p_query        vector(768),
  p_match_count  INT DEFAULT 12,
  p_source_types TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  source_id UUID,
  source_type TEXT,
  url TEXT,
  title TEXT,
  content TEXT,
  captured_at TIMESTAMPTZ,
  score FLOAT
)
LANGUAGE sql STABLE
AS $$
  WITH vec AS (
    SELECT rd.id, row_number() OVER (ORDER BY rd.embedding <=> p_query) AS rnk
    FROM research_documents rd
    WHERE rd.brand_id = p_brand_id
      AND rd.embedding IS NOT NULL
      AND rd.deleted_by_user = false
      AND (p_source_types IS NULL OR rd.source_type = ANY(p_source_types))
    ORDER BY rd.embedding <=> p_query
    LIMIT 40
  ),
  fts AS (
    SELECT rd.id,
           row_number() OVER (
             ORDER BY ts_rank(
               to_tsvector('english', coalesce(rd.title,'') || ' ' || rd.content),
               plainto_tsquery('english', p_query_text)
             ) DESC
           ) AS rnk
    FROM research_documents rd
    WHERE rd.brand_id = p_brand_id
      AND rd.deleted_by_user = false
      AND (p_source_types IS NULL OR rd.source_type = ANY(p_source_types))
      AND to_tsvector('english', coalesce(rd.title,'') || ' ' || rd.content)
          @@ plainto_tsquery('english', p_query_text)
    LIMIT 40
  ),
  rrf AS (
    SELECT COALESCE(v.id, f.id) AS id,
           COALESCE(1.0 / (60 + v.rnk), 0) + COALESCE(1.0 / (60 + f.rnk), 0) AS score
    FROM vec v
    FULL OUTER JOIN fts f USING (id)
  )
  SELECT rd.id, rd.source_id, rd.source_type, rd.url, rd.title, rd.content,
         rd.captured_at, rrf.score
  FROM rrf
  JOIN research_documents rd ON rd.id = rrf.id
  ORDER BY rrf.score DESC
  LIMIT LEAST(p_match_count, 50);
$$;
