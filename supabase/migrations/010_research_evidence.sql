-- 010_research_evidence.sql
-- V2 Phase 1 — Evidence Persistence (the moat foundation).
--
-- BEFORE THIS MIGRATION the research pipeline discarded everything it read:
--   worker/processors/brand-research.ts → src/lib/gemini.ts generateStructured()
--   kept only resp.text; groundingMetadata (Google Search sources), urlContext
--   page fetches, and usageMetadata (tokens) were all thrown away. The brand
--   profile was an *uncited conclusion* with no underlying evidence.
--
-- AFTER: every research run is tracked (research_runs), every source the run
-- read is persisted as chunked + embedded evidence (research_documents), and
-- artifacts carry `grounded_on` arrays of evidence ids so future analytics can
-- answer "which evidence sources produce the highest-performing content?".
--
-- RETENTION STRATEGY (deliberate):
--   * Evidence is NEVER hard-deleted by the system — it is the accumulating
--     asset. Users soft-delete (deleted_by_user) which acts as a negative
--     signal to synthesis; rows stay for attribution integrity.
--   * freshness_ttl_days marks when a source should be considered STALE (a
--     refresh signal), not when it should be removed.
--   * Refresh runs insert new rows; unchanged content is deduped via the
--     (brand_id, content_hash) unique constraint, so re-running research on
--     an unchanged site costs ~zero storage.

CREATE EXTENSION IF NOT EXISTS vector;

-- ─── research_runs — one row per research execution ──────────────────────────
CREATE TABLE IF NOT EXISTS research_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id             UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  -- The UI-facing job row (logs/progress). Nullable: future runs (scheduled
  -- collectors, manual facet refreshes) won't always have one.
  research_job_id      UUID REFERENCES brand_research_jobs(id) ON DELETE SET NULL,
  trigger              TEXT NOT NULL DEFAULT 'create',
  facets               TEXT[] NOT NULL DEFAULT '{website,competitors,seo,topics}',
  status               TEXT NOT NULL DEFAULT 'running',
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ,
  duration_ms          INTEGER,
  sources_collected    INTEGER NOT NULL DEFAULT 0,   -- distinct sources read
  chunks_stored        INTEGER NOT NULL DEFAULT 0,   -- evidence rows written (post-dedupe)
  chunks_embedded      INTEGER NOT NULL DEFAULT 0,
  tokens_input         BIGINT  NOT NULL DEFAULT 0,
  tokens_output        BIGINT  NOT NULL DEFAULT 0,
  cost_estimate_usd    NUMERIC(10,5),
  -- brands.profile_version this run produced (traceability: run → intelligence)
  intelligence_version INTEGER,
  error_message        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT research_runs_trigger_check
    CHECK (trigger IN ('create','retry','refresh','manual','scheduled')),
  CONSTRAINT research_runs_status_check
    CHECK (status IN ('running','done','failed'))
);

CREATE INDEX IF NOT EXISTS research_runs_brand_id_idx ON research_runs(brand_id);
CREATE INDEX IF NOT EXISTS research_runs_status_idx   ON research_runs(status);

-- ─── research_documents — the evidence store ─────────────────────────────────
-- One row per CHUNK of source material. chunk_index orders chunks within a
-- source (url + capture). 768-dim embeddings (Gemini text-embedding-004).
CREATE TABLE IF NOT EXISTS research_documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id           UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  run_id             UUID REFERENCES research_runs(id) ON DELETE SET NULL,
  source_type        TEXT NOT NULL,
  url                TEXT,
  domain             TEXT,
  title              TEXT,
  content            TEXT NOT NULL,
  chunk_index        INTEGER NOT NULL DEFAULT 0,
  content_hash       TEXT NOT NULL,                  -- sha256 of normalized chunk
  summary            TEXT,                           -- optional AI summary (filled lazily)
  entities           JSONB,                          -- optional extracted entities (filled lazily)
  keywords           TEXT[],                         -- optional extracted keywords (filled lazily)
  embedding          vector(768),                    -- NULL until embedded (best-effort + backfillable)
  embedding_model    TEXT,
  captured_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  freshness_ttl_days INTEGER NOT NULL DEFAULT 90,
  deleted_by_user    BOOLEAN NOT NULL DEFAULT false,
  metadata           JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT research_documents_source_type_check
    CHECK (source_type IN (
      'website','search_result','competitor','industry',
      'keyword','social','news','manual'
    )),
  -- Cross-run dedupe: identical chunk content for the same brand is stored once.
  CONSTRAINT research_documents_brand_hash_uniq UNIQUE (brand_id, content_hash)
);

CREATE INDEX IF NOT EXISTS research_documents_brand_id_idx    ON research_documents(brand_id);
CREATE INDEX IF NOT EXISTS research_documents_run_id_idx      ON research_documents(run_id);
CREATE INDEX IF NOT EXISTS research_documents_source_type_idx ON research_documents(brand_id, source_type);
CREATE INDEX IF NOT EXISTS research_documents_domain_idx      ON research_documents(domain);

-- Semantic search (RAG retrieval). HNSW: good recall, no training step,
-- handles incremental inserts — right default at this scale.
CREATE INDEX IF NOT EXISTS research_documents_embedding_idx
  ON research_documents USING hnsw (embedding vector_cosine_ops);

-- Keyword/full-text search (hybrid retrieval partner to the vector index).
CREATE INDEX IF NOT EXISTS research_documents_fts_idx
  ON research_documents
  USING gin (to_tsvector('english', coalesce(title,'') || ' ' || content));

-- ─── Grounding columns — artifacts know their evidence ───────────────────────
-- Coarse-grained at first (run/source-set level), per-statement later. The
-- column shape (uuid[] of research_documents.id) supports both.
ALTER TABLE brand_topics  ADD COLUMN IF NOT EXISTS grounded_on UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE brand_topics  ADD COLUMN IF NOT EXISTS confidence  REAL;
ALTER TABLE brand_topics  ADD COLUMN IF NOT EXISTS performance JSONB NOT NULL DEFAULT '{}';
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS grounded_on UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE render_jobs   ADD COLUMN IF NOT EXISTS grounded_on UUID[] NOT NULL DEFAULT '{}';

-- ─── Brand intelligence versioning + source attribution ──────────────────────
-- profile_version increments per research run that rewrites brands.profile.
-- profile_citations maps profile sections → evidence ids, e.g.
--   { "profile": ["<doc-id>", ...], "competitors": ["<doc-id>", ...] }
-- Coarse today (section level); per-field paths use the same shape later
-- ("audience.demographics": [...]) without a schema change. This is the
-- architecture for click-statement → view-source-evidence UI.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS profile_version      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS profile_citations    JSONB   NOT NULL DEFAULT '{}';
ALTER TABLE brands ADD COLUMN IF NOT EXISTS last_research_run_id UUID;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Same pattern as brand_topics (005): reads traverse brand ownership via
-- current_clerk_user_id(); writes are service-role only (the worker).
ALTER TABLE research_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "research_runs_owner_select" ON research_runs;
CREATE POLICY "research_runs_owner_select"
  ON research_runs FOR SELECT
  USING (
    brand_id IN (
      SELECT id FROM brands WHERE user_id = current_clerk_user_id()
    )
  );

DROP POLICY IF EXISTS "research_documents_owner_select" ON research_documents;
CREATE POLICY "research_documents_owner_select"
  ON research_documents FOR SELECT
  USING (
    brand_id IN (
      SELECT id FROM brands WHERE user_id = current_clerk_user_id()
    )
  );

-- Users may soft-delete (set deleted_by_user) / annotate their own evidence.
DROP POLICY IF EXISTS "research_documents_owner_update" ON research_documents;
CREATE POLICY "research_documents_owner_update"
  ON research_documents FOR UPDATE
  USING (
    brand_id IN (
      SELECT id FROM brands WHERE user_id = current_clerk_user_id()
    )
  );

-- ─── Semantic search RPC (RAG entry point) ───────────────────────────────────
-- SECURITY INVOKER: runs under the caller's RLS, so users can only search
-- their own brands' evidence. The worker (service role) bypasses RLS as usual.
CREATE OR REPLACE FUNCTION match_research_documents(
  p_brand_id   UUID,
  p_query      vector(768),
  p_match_count INT DEFAULT 8,
  p_source_types TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  source_type TEXT,
  url TEXT,
  title TEXT,
  content TEXT,
  captured_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    rd.id, rd.source_type, rd.url, rd.title, rd.content, rd.captured_at,
    1 - (rd.embedding <=> p_query) AS similarity
  FROM research_documents rd
  WHERE rd.brand_id = p_brand_id
    AND rd.embedding IS NOT NULL
    AND rd.deleted_by_user = false
    AND (p_source_types IS NULL OR rd.source_type = ANY(p_source_types))
  ORDER BY rd.embedding <=> p_query
  LIMIT LEAST(p_match_count, 50);
$$;
