-- 018_content_creatives.sql
-- Brand Creative Orchestrator — Phase B: creative strategy layer.
-- Additive only. One table + one brands column + one storage bucket.
--
-- content_creatives carries the Creative Brief (jsonb, source of truth) and
-- the CREATIVE APPROVAL GATE state machine:
--
--   brief_ready   brief composed, awaiting human review (THE GATE — no image
--                 generation may start from this state)
--   approved      user approved the brief; Phase C enqueues generation
--   generating    worker is producing background + composite (Phase C)
--   ready         composite image stored, image_url set (Phase C)
--   failed        generation failed; regenerate allowed (Phase C)
--   rejected      brief declined — compose a fresh brief instead
--
-- The gate exists to catch poor creative strategy BEFORE Imagen costs are
-- incurred: the only transition into 'generating' is from 'approved'.
--
-- creative_hierarchy + creative_confidence are DENORMALIZED out of the brief
-- so Phase D attribution can group/filter without parsing jsonb:
--   which hierarchy performs best? per brand? per platform?

CREATE TABLE IF NOT EXISTS content_creatives (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id      UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  brand_id             UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'brief_ready'
                       CHECK (status IN ('brief_ready','approved','generating','ready','failed','rejected')),
  -- Source of truth — shape: src/lib/creative/types.ts (CreativeBrief, Zod).
  creative_brief       JSONB NOT NULL,
  -- Denormalized for attribution (Phase D).
  creative_hierarchy   TEXT NOT NULL
                       CHECK (creative_hierarchy IN ('founder_led','brand_led','data_led','quote_led','product_led')),
  creative_confidence  NUMERIC(4,3) NOT NULL CHECK (creative_confidence >= 0 AND creative_confidence <= 1),
  platform             TEXT NOT NULL,
  -- Phase C outputs
  background_url       TEXT,
  image_url            TEXT,
  generation_error     TEXT,
  generated_at         TIMESTAMPTZ,
  regen_count          INTEGER NOT NULL DEFAULT 0,
  -- Same append-only audit trail as content_items: [{from,to,at,by,note?}]
  status_history       JSONB NOT NULL DEFAULT '[]',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_creatives_item_idx
  ON content_creatives(content_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_creatives_brand_status_idx
  ON content_creatives(brand_id, status);
-- Phase D attribution read: hierarchy performance across ready creatives.
CREATE INDEX IF NOT EXISTS content_creatives_hierarchy_idx
  ON content_creatives(creative_hierarchy)
  WHERE status = 'ready';

DROP TRIGGER IF EXISTS content_creatives_updated_at ON content_creatives;
CREATE TRIGGER content_creatives_updated_at
  BEFORE UPDATE ON content_creatives
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- RLS: owner-read via brand → user; writes via service role (routes + worker
-- check ownership explicitly — same pattern as content_metrics).
ALTER TABLE content_creatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_creatives_owner_select" ON content_creatives;
CREATE POLICY "content_creatives_owner_select"
  ON content_creatives FOR SELECT
  USING (
    brand_id IN (
      SELECT id FROM brands WHERE user_id = current_clerk_user_id()
    )
  );

-- Realtime: the creative panel watches status flips during Phase C generation
-- (brief_ready → approved → generating → ready) the same way render_jobs does.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'content_creatives'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE content_creatives;
  END IF;
END $$;

-- ─── brands.creative_preferences (learning structure, READ-ONLY in v1) ──────
-- Shape (documented for Phase D; nothing auto-writes this yet):
-- {
--   "preferred_hierarchy": "founder_led",          -- operator/user override
--   "platform_hierarchy": { "linkedin": "data_led" },
--   "avoid_hierarchies": ["quote_led"],
--   "notes": "free text"
-- }
-- The hierarchy engine READS these as a scoring nudge; Phase D analytics will
-- eventually inform writes (human-in-the-loop, never automatic in v1).
ALTER TABLE brands ADD COLUMN IF NOT EXISTS creative_preferences JSONB NOT NULL DEFAULT '{}';

-- ─── Storage bucket: content-creatives (Phase C output) ─────────────────────
-- Public-read like brand-assets/merged-videos; uuid paths; service-role writes.
INSERT INTO storage.buckets (id, name, public)
VALUES ('content-creatives', 'content-creatives', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Public read on content-creatives" ON storage.objects;
CREATE POLICY "Public read on content-creatives"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'content-creatives');
