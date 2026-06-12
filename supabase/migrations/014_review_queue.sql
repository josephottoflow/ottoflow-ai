-- 014_review_queue.sql
-- V2 Phase 2 (first slice) — Review Queue: the approval layer publishing will
-- later build on. Additive; existing rows keep their status values.
--
-- Lifecycle:
--   draft       authoring/generating, or revision requested (see review_note)
--   in_review   generated and awaiting a decision (worker sets this on
--               successful generation — the queue fills itself)
--   approved    cleared for use/publishing
--   rejected    declined (review_note carries the why)
--   scheduled   future: publisher slot assigned
--   published   future: live on a platform
--
-- Lifecycle TRACKING is column-level (review_note, reviewed_at) plus an
-- append-only status_history jsonb: [{from,to,at,by,note?}]. History is
-- written by the app (worker + review route) — no triggers, keeps it simple
-- and debuggable.

-- Extend the status state machine (constraint recreate is the only way to
-- widen a CHECK; instant on this table size).
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_status_check;
ALTER TABLE content_items ADD CONSTRAINT content_items_status_check
  CHECK (status IN ('draft','in_review','approved','rejected','scheduled','published'));

ALTER TABLE content_items ADD COLUMN IF NOT EXISTS review_note    TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS reviewed_at    TIMESTAMPTZ;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS status_history JSONB NOT NULL DEFAULT '[]';

-- The queue's primary read: "this user's items by status, newest first".
CREATE INDEX IF NOT EXISTS content_items_brand_status_idx
  ON content_items(brand_id, status);
