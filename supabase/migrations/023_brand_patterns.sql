-- 023_brand_patterns.sql
-- P4 Phase 2A — Brand Pattern Library (deterministic brand identity).
-- ADDITIVE ONLY · REVERSIBLE · NULLABLE-SAFE · idempotent.
--
-- One brand has many pattern versions; at most one is_active=true at a time.
-- `pattern` jsonb holds the DNA (color/composition/motif/typography/energy/
-- spacing/framing/do_not_use — see src/lib/creative/types.ts brandPatternSchema).
-- Consumed deterministically by the sharp compositor; NEVER sent to a model.
--
-- Rollback:
--   ALTER TABLE content_creatives DROP COLUMN IF EXISTS brand_pattern_version;
--   DROP TABLE IF EXISTS brand_patterns;

CREATE TABLE IF NOT EXISTS public.brand_patterns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  version           integer NOT NULL DEFAULT 1,
  -- The DNA payload. Nullable-safe: a brand with no row (or no active row)
  -- renders exactly as today (palette + logo only).
  pattern           jsonb,
  -- Latest Brand Recognition Score (0–100) for this version; null until scored.
  recognition_score numeric,
  is_active         boolean NOT NULL DEFAULT false,
  source            text NOT NULL DEFAULT 'manual',  -- 'manual' | 'ai_derived' | 'hybrid'
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_patterns_version_unique UNIQUE (brand_id, version)
);

-- At most one active pattern per brand.
CREATE UNIQUE INDEX IF NOT EXISTS brand_patterns_one_active_idx
  ON public.brand_patterns(brand_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS brand_patterns_brand_id_idx ON public.brand_patterns(brand_id);

-- updated_at trigger (reuses the helper from 001).
DROP TRIGGER IF EXISTS brand_patterns_updated_at ON public.brand_patterns;
CREATE TRIGGER brand_patterns_updated_at
  BEFORE UPDATE ON public.brand_patterns
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- RLS — scoped via brands.user_id traversal (same pattern as scene_generations).
ALTER TABLE public.brand_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brand_patterns_owner_select" ON public.brand_patterns;
CREATE POLICY "brand_patterns_owner_select"
  ON public.brand_patterns FOR SELECT
  USING (
    brand_id IN (
      SELECT id FROM public.brands WHERE user_id = public.current_clerk_user_id()
    )
  );

-- Snapshot which pattern version produced a creative (reproducibility + BRS attribution).
ALTER TABLE public.content_creatives
  ADD COLUMN IF NOT EXISTS brand_pattern_version integer;
