-- 007_scene_generations.sql
-- Per-scene provenance for the new scene-based video composition
-- pipeline. Each render_job spawns 3-6 scene_generations rows — one
-- per storyboard scene — so we can:
--   - Track which provider produced each clip (Runway / Luma / Pexels)
--   - Show generation time per scene in the history detail view
--   - Surface fallback reasons when a provider failed and the chain
--     fell through
--   - Aggregate provider success rates over time

CREATE TABLE IF NOT EXISTS scene_generations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  render_job_id       UUID NOT NULL REFERENCES render_jobs(id) ON DELETE CASCADE,
  scene_number        INTEGER NOT NULL,
  prompt              TEXT NOT NULL,
  shot_type           TEXT,
  provider            TEXT NOT NULL,                    -- 'runway' | 'luma' | 'pexels'
  clip_url            TEXT,                              -- direct MP4 URL (Pexels CDN, Runway, Luma, etc)
  duration_sec        NUMERIC,
  width               INTEGER,
  height              INTEGER,
  generation_time_ms  INTEGER,
  cost_usd            NUMERIC,
  fallback_reason     TEXT,                              -- populated when primary provider(s) failed
  attribution         TEXT,
  metadata            JSONB,                             -- provider-specific details (seed photo, model, etc)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scene_generations_unique_per_job
    UNIQUE (render_job_id, scene_number)
);

CREATE INDEX IF NOT EXISTS scene_generations_render_job_id_idx ON scene_generations(render_job_id);
CREATE INDEX IF NOT EXISTS scene_generations_provider_idx      ON scene_generations(provider);

-- RLS via render_jobs.user_id traversal — same pattern as content_items.
ALTER TABLE scene_generations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scene_generations_owner_select" ON scene_generations;
CREATE POLICY "scene_generations_owner_select"
  ON scene_generations FOR SELECT
  USING (
    render_job_id IN (
      SELECT id FROM render_jobs
      WHERE user_id = current_clerk_user_id()
    )
  );

-- Realtime so /video/[jobId] detail view can stream scene-completion
-- updates as each provider call returns.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'scene_generations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE scene_generations;
  END IF;
END $$;
