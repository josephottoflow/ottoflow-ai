-- 013_opportunity_mining.sql
-- V2 Phase 2C — Intelligence → Ideas. Additive only.
--
-- Evidence-mined opportunities are stored as brand_topics rows (so they flow
-- through every existing surface: topic pickers, generate deep-links, the
-- Grounding Inspector) with two new columns for explainability:
--
--   rationale         WHY this idea exists — written against the evidence,
--                      shown verbatim in the Opportunity Feed.
--   opportunity_kind  The detection lens that produced it:
--                      pain_point | theme | competitor_gap | trend
--                      (NULL for non-mined topics.)
--
-- Per-idea grounding uses the EXISTING brand_topics.grounded_on (mig 010) —
-- but mined ideas cite the specific evidence chunks behind THAT idea, not
-- the run-level source set. Scoring uses the existing confidence column.
-- source='evidence-mined' distinguishes mined rows (source has no CHECK).

ALTER TABLE brand_topics ADD COLUMN IF NOT EXISTS rationale        TEXT;
ALTER TABLE brand_topics ADD COLUMN IF NOT EXISTS opportunity_kind TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brand_topics_opportunity_kind_check'
  ) THEN
    ALTER TABLE brand_topics
      ADD CONSTRAINT brand_topics_opportunity_kind_check
      CHECK (opportunity_kind IS NULL OR opportunity_kind IN (
        'pain_point','theme','competitor_gap','trend'
      ));
  END IF;
END $$;
