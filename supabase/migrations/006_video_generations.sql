-- 006_video_generations.sql
-- Extends render_jobs to be the SINGLE source of truth for every video
-- generation: brand context, topic source, generated artifacts (script /
-- storyboard / SEO / overlays), and intermediate asset URLs (narration,
-- music, video) — not just the merged output URL.
--
-- This lets /video/history show every past run with full provenance,
-- supports "Regenerate" via redoing the merge from cached assets, and
-- means a page reload mid-flow doesn't destroy the work.
--
-- Why extend render_jobs vs creating video_generations:
--   The render_jobs row already carries status, progress, output_url,
--   merged_video_url, and is filtered into by the merge worker. Splitting
--   it would force every read to JOIN. Extension keeps cardinality 1:1.

-- ─── New columns ─────────────────────────────────────────────────────────────
ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS user_id          TEXT,
  ADD COLUMN IF NOT EXISTS brand_id         UUID REFERENCES brands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS topic_id         UUID REFERENCES brand_topics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS style            TEXT,
  ADD COLUMN IF NOT EXISTS script_json      JSONB,
  ADD COLUMN IF NOT EXISTS storyboard_json  JSONB,
  ADD COLUMN IF NOT EXISTS seo_json         JSONB,
  ADD COLUMN IF NOT EXISTS overlay_json     JSONB,
  ADD COLUMN IF NOT EXISTS narration_url    TEXT,
  ADD COLUMN IF NOT EXISTS music_url        TEXT,
  ADD COLUMN IF NOT EXISTS music_track      TEXT,
  ADD COLUMN IF NOT EXISTS video_attribution TEXT,
  -- Migration 001 created render_jobs with `started_at` but no `created_at`.
  -- /video/history needs a stable creation timestamp distinct from
  -- "when the render started" so we add it here, backfilled from started_at.
  ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE render_jobs SET created_at = started_at WHERE created_at IS NULL OR created_at = started_at;

CREATE INDEX IF NOT EXISTS render_jobs_user_id_idx  ON render_jobs(user_id);
CREATE INDEX IF NOT EXISTS render_jobs_brand_id_idx ON render_jobs(brand_id);
CREATE INDEX IF NOT EXISTS render_jobs_topic_id_idx ON render_jobs(topic_id);
CREATE INDEX IF NOT EXISTS render_jobs_created_at_idx ON render_jobs(created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Previously render_jobs was inserted with project_id=null and no RLS scope
-- on user. We now scope reads + updates to user_id directly. The worker
-- writes via service_role (bypasses RLS) so insert policies aren't needed
-- for the worker.
ALTER TABLE render_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "render_jobs_owner_select" ON render_jobs;
CREATE POLICY "render_jobs_owner_select"
  ON render_jobs FOR SELECT
  USING (user_id = current_clerk_user_id());

DROP POLICY IF EXISTS "render_jobs_owner_update" ON render_jobs;
CREATE POLICY "render_jobs_owner_update"
  ON render_jobs FOR UPDATE
  USING (user_id = current_clerk_user_id());

-- ─── brand_topics use-count helper ───────────────────────────────────────────
-- Atomic increment so concurrent renders from the same topic don't race.
CREATE OR REPLACE FUNCTION increment_brand_topic_use(p_topic_id UUID)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE brand_topics
     SET use_count = use_count + 1,
         used_at = now(),
         status = CASE WHEN status = 'draft' THEN 'used' ELSE status END
   WHERE id = p_topic_id;
$$;
