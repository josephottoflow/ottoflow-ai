-- 032_creative_variations.sql
-- Creative Studio — Proposal A: variation history.
-- Additive only. One table + RLS. Reversible (rollback at bottom).
--
-- WHY: content_creatives.image_url is OVERWRITTEN on every regenerate
-- (regen_count++), so prior renders are lost — no variations, no side-by-side
-- compare, no "restore a previous version". This table records each distinct
-- rendered image as its own row so those three features become possible
-- WITHOUT changing the generation pipeline (rows are captured at the API layer;
-- the worker is untouched).
--
-- "Selected" is NOT stored — it is derived at read time by comparing a row's
-- image_url with the parent content_creatives.image_url pointer. Restoring a
-- version is therefore just a pointer swap on content_creatives (no re-render).

CREATE TABLE IF NOT EXISTS creative_variations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id       UUID NOT NULL REFERENCES content_creatives(id) ON DELETE CASCADE,
  -- Denormalized for fast per-item reads + RLS parity with content_creatives.
  content_item_id   UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  brand_id          UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  -- The rendered image this variation captured (source of truth = storage).
  image_url         TEXT NOT NULL,
  background_url    TEXT,
  background_source TEXT,
  -- The brief that produced THIS image, for the compare "why" panel (optional).
  brief_snapshot    JSONB,
  -- regen_count of the parent creative at capture time (0 = first render).
  regen_index       INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Idempotent capture: the same image is only ever recorded once per creative.
  CONSTRAINT creative_variations_unique_image UNIQUE (creative_id, image_url)
);

CREATE INDEX IF NOT EXISTS creative_variations_creative_idx
  ON creative_variations(creative_id, created_at DESC);

-- RLS: owner-read via brand → user (identical shape to content_creatives).
-- Writes go through the service role in API routes, which check ownership
-- explicitly via Clerk auth — same pattern as content_creatives / content_metrics.
ALTER TABLE creative_variations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "creative_variations_owner_select" ON creative_variations;
CREATE POLICY "creative_variations_owner_select"
  ON creative_variations FOR SELECT
  USING (
    brand_id IN (
      SELECT id FROM brands WHERE user_id = current_clerk_user_id()
    )
  );

-- ─── Rollback (reversible) ──────────────────────────────────────────────────
-- DROP POLICY IF EXISTS "creative_variations_owner_select" ON creative_variations;
-- DROP TABLE IF EXISTS creative_variations;
