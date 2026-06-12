-- 015_publisher_foundation.sql
-- V2 Phase 2 (slice 2) — Publisher Foundation v1: the approved → scheduled →
-- published lifecycle. Additive; no new tables (a content_item IS one
-- platform post, so publishing metadata lives on the row).
--
-- v1 is MANUAL publishing: copy → open platform → mark published
-- (publishing_method='manual', platform_post_id NULL). Future API publishers
-- (linkedin_api, x_api, facebook_api, …) execute the SAME transitions through
-- the same route contract and fill platform_post_id — no further schema.
--
-- Scheduling semantics in v1: scheduled_for is a PLAN, not an automation —
-- nothing fires at that time. The future API publisher turns the plan into
-- an execution.

ALTER TABLE content_items ADD COLUMN IF NOT EXISTS scheduled_for     TIMESTAMPTZ;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS published_at      TIMESTAMPTZ;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS published_url     TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS platform_post_id  TEXT;
-- Open vocabulary by design ('manual' today; 'linkedin_api' | 'x_api' | … later)
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS publishing_method TEXT;

-- "What's due?" — the publishing queue's scheduled-tab read.
CREATE INDEX IF NOT EXISTS content_items_scheduled_for_idx
  ON content_items(scheduled_for)
  WHERE status = 'scheduled';
