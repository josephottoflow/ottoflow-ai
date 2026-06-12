-- 016_analytics_ingestion.sql
-- Analytics Ingestion v1 — close the loop: published content → performance.
-- Additive only. One table + one view.
--
-- content_metrics is a SNAPSHOT log, not mutable columns: manual entry today
-- writes source='manual'; platform APIs later write source='linkedin_api'/
-- 'x_api'/… on a schedule (d1/d7 time-series) with ZERO schema change —
-- same open-vocabulary pattern as content_items.publishing_method.
-- engagement_rate is computed at write time ((likes+comments+shares+saves+
-- clicks)/impressions) and frozen with the snapshot.

CREATE TABLE IF NOT EXISTS content_metrics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id  UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source           TEXT NOT NULL DEFAULT 'manual',
  impressions      INTEGER CHECK (impressions >= 0),
  reach            INTEGER CHECK (reach >= 0),
  likes            INTEGER CHECK (likes >= 0),
  comments         INTEGER CHECK (comments >= 0),
  shares           INTEGER CHECK (shares >= 0),
  saves            INTEGER CHECK (saves >= 0),
  clicks           INTEGER CHECK (clicks >= 0),
  engagement_rate  NUMERIC(7,4),
  metadata         JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS content_metrics_item_captured_idx
  ON content_metrics(content_item_id, captured_at DESC);

-- Latest snapshot per item — the dashboard's read. security_invoker so the
-- caller's RLS applies (Postgres 15+ / Supabase).
CREATE OR REPLACE VIEW content_latest_metrics
WITH (security_invoker = true) AS
SELECT DISTINCT ON (content_item_id)
  content_item_id, captured_at, source,
  impressions, reach, likes, comments, shares, saves, clicks, engagement_rate
FROM content_metrics
ORDER BY content_item_id, captured_at DESC;

-- RLS: owner-read via item → brand → user; writes via service role (the
-- metrics route checks ownership explicitly, same pattern as review/publish).
ALTER TABLE content_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_metrics_owner_select" ON content_metrics;
CREATE POLICY "content_metrics_owner_select"
  ON content_metrics FOR SELECT
  USING (
    content_item_id IN (
      SELECT ci.id FROM content_items ci
      JOIN brands b ON b.id = ci.brand_id
      WHERE b.user_id = current_clerk_user_id()
    )
  );
