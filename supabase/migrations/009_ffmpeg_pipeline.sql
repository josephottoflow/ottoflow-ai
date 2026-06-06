-- 009_ffmpeg_pipeline.sql
-- ADR-002 — FFmpeg multi-agent pipeline schema.
--
-- Adds:
--   - asset_history    : per-user clip usage ledger (Agent 6 dedup).
--   - scene_candidates : every candidate the search/analysis agents
--                        considered, with their scores — for debugging
--                        "why did the agent pick THIS clip?" weeks later.
--   - render_jobs.composition_plan / qc_report / pipeline_version /
--     r2_object_key  / gdrive_file_id columns.
--
-- The render_jobs row stays the single source of truth per job. The two
-- new tables are append-only audit data, scoped per user via the existing
-- current_clerk_user_id() helper.

-- ─── asset_history ─────────────────────────────────────────────────────────
-- Agent 6 (Diversity) reads the most recent 100 rows per user and applies
-- a penalty for any candidate whose (source, source_id) appears there.
-- Write-once on render completion — the Agent 11 worker upserts one row
-- per scene clip into this table inside the same transaction that marks
-- the render_jobs row done.

CREATE TABLE IF NOT EXISTS asset_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  source        TEXT NOT NULL,    -- 'pexels'|'pixabay'|'mixkit'|'coverr'|'runway'|'luma'
  source_id     TEXT NOT NULL,    -- provider's native id
  asset_url     TEXT NOT NULL,
  render_job_id UUID REFERENCES render_jobs(id) ON DELETE SET NULL,
  topic         TEXT,             -- denormalised search context for analytics
  used_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The dedup query is "the last N rows for this user" — covering index.
CREATE INDEX IF NOT EXISTS asset_history_user_recent_idx
  ON asset_history(user_id, used_at DESC);

-- Defend against a worker retry double-inserting the same (job, asset) pair.
-- NULL render_job_id is allowed (manual / backfill rows) so we partial-index.
CREATE UNIQUE INDEX IF NOT EXISTS asset_history_uniq_per_job_asset
  ON asset_history(render_job_id, source, source_id)
  WHERE render_job_id IS NOT NULL;

ALTER TABLE asset_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "asset_history_owner_select" ON asset_history;
CREATE POLICY "asset_history_owner_select"
  ON asset_history FOR SELECT
  USING (user_id = current_clerk_user_id());

-- ─── scene_candidates ──────────────────────────────────────────────────────
-- Every clip the Multi-Source Search agent retrieved + every score
-- Agents 5/6/7 applied. was_selected = true on the ONE row per scene
-- that won. Bounded to ~50 rows/scene * 4 scenes = ~200 rows/job — small.

CREATE TABLE IF NOT EXISTS scene_candidates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  render_job_id   UUID NOT NULL REFERENCES render_jobs(id) ON DELETE CASCADE,
  scene_number    INTEGER NOT NULL,
  source          TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  url             TEXT NOT NULL,
  preview_url     TEXT,
  width           INTEGER,
  height          INTEGER,
  duration_sec    NUMERIC,
  query           TEXT,            -- which expanded query surfaced this hit
  raw_score       NUMERIC,         -- Agent 5
  relevance       NUMERIC,
  quality         NUMERIC,
  framing         NUMERIC,
  motion          NUMERIC,
  diversity_pen   NUMERIC,         -- Agent 6 (subtracted)
  consistency     NUMERIC,         -- Agent 7
  final_score     NUMERIC,         -- post-Agents 5+6+7
  was_selected    BOOLEAN NOT NULL DEFAULT false,
  reason          TEXT,            -- human-readable selection rationale
  metadata        JSONB,           -- provider-specific extras
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scene_candidates_render_idx
  ON scene_candidates(render_job_id, scene_number);
CREATE INDEX IF NOT EXISTS scene_candidates_selected_idx
  ON scene_candidates(render_job_id) WHERE was_selected = true;

ALTER TABLE scene_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scene_candidates_owner_select" ON scene_candidates;
CREATE POLICY "scene_candidates_owner_select"
  ON scene_candidates FOR SELECT
  USING (
    render_job_id IN (
      SELECT id FROM render_jobs WHERE user_id = current_clerk_user_id()
    )
  );

-- ─── render_jobs deltas ────────────────────────────────────────────────────
-- composition_plan : the full Agent 1-10 output frozen at enqueue time. The
--                    worker (Agent 11) consumes this with zero further LLM
--                    calls. A user-facing "Re-render with edits" feature can
--                    later let the UI mutate this JSON and re-enqueue.
-- qc_report        : Agent 12's verdict + per-agent issues.
-- pipeline_version : 'remotion-v1' (legacy) | 'ffmpeg-v2' (this ADR). Lets
--                    Sentry / dashboards segment errors by pipeline during
--                    the 30-day overlap window.
-- r2_object_key    : Cloudflare R2 object key (primary storage).
-- gdrive_file_id   : Google Drive fallback file id when user opted in.

ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS composition_plan JSONB,
  ADD COLUMN IF NOT EXISTS qc_report        JSONB,
  ADD COLUMN IF NOT EXISTS pipeline_version TEXT,
  ADD COLUMN IF NOT EXISTS r2_object_key    TEXT,
  ADD COLUMN IF NOT EXISTS gdrive_file_id   TEXT;

CREATE INDEX IF NOT EXISTS render_jobs_pipeline_version_idx
  ON render_jobs(pipeline_version);

-- ─── Realtime ──────────────────────────────────────────────────────────────
-- scene_candidates streams to the client during long search/analysis phases
-- so the UI can show "13 candidates considered" live.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'scene_candidates'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE scene_candidates;
  END IF;
END $$;
