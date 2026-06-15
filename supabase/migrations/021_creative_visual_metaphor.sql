-- 021_creative_visual_metaphor.sql
-- Topic → Visual Metaphor Engine (P4 Phase 1). The opposition a topic
-- dramatizes (visual_tension, e.g. "Complexity vs Simplicity") and the
-- abstract visual that depicts it (visual_metaphor). Denormalized from the
-- creative_brief jsonb for analytics ("which metaphors perform best?").
-- Additive, nullable.

ALTER TABLE content_creatives ADD COLUMN IF NOT EXISTS visual_tension TEXT;
ALTER TABLE content_creatives ADD COLUMN IF NOT EXISTS visual_metaphor TEXT;
