-- 019_creative_branding.sql
-- Brand Creative Orchestrator — per-creative branding overrides captured on
-- /content/generate (Company / Founder / Expert name + use_logo / use_headshot
-- toggles). Additive, nullable. Consumed by composeCreativeBrief when the
-- creative is composed for the item.
--
-- Shape (src/lib/types.ts DbContentItem.creative_branding):
-- { "companyName": "...", "founderName": "...", "expertName": "...",
--   "useLogo": true, "useHeadshot": true }

ALTER TABLE content_items ADD COLUMN IF NOT EXISTS creative_branding JSONB;
