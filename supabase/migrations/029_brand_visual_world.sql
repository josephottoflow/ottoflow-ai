-- 029_brand_visual_world.sql — Visual World V1 (Brand Finish Layer, Phase 1)
-- Additive + idempotent. The brand's persistent "how it looks" object, read by
-- video composition (grade, logo, CTA end-card, caption typography). Nullable →
-- absent worlds fall back to the existing brief-derived branding (no behaviour
-- change until populated). No new table, no RLS change (rides brands' policies).

ALTER TABLE brands ADD COLUMN IF NOT EXISTS visual_world jsonb;

COMMENT ON COLUMN brands.visual_world IS
  'Visual World V1 {palette, grade, stylePreamble, negativePrompt, cameraGrammar, seedFamily, typography, logo, endcard}. Source of truth for brand video finish. Read-only below the brand layer.';
