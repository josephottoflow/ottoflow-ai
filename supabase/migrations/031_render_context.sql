-- 031_render_context.sql — Sprint 39.2
--
-- Persist the COMPLETE render context at approve time so a single scene can be
-- re-generated later (Scene Inspector → Replace Visual) without reconstructing
-- in-memory-only fields by guesswork.
--
-- Problem (Sprint 39.2 Phase 1): the scene-generation job payload carries
-- platform / aspectRatio / mode / resolution / quality / source / branding, but
-- render_jobs only persisted strategy (video_strategy), brand_id, prompt and
-- scene_provider. The rest lived only in the request → a re-render couldn't
-- reproduce the same settings.
--
-- Fix: one additive, nullable JSONB column holding the scene-generation context
-- (everything EXCEPT renderJobId/userId/strategy, which are already recoverable).
-- Provider-agnostic (Phase 7) — it's just the job payload, not Pexels-specific.
-- Backward compatible: NULL on every pre-existing row; the replace endpoint
-- degrades gracefully (409) when it's absent.

ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS render_context jsonb;

COMMENT ON COLUMN render_jobs.render_context IS
  'Sprint 39.2: persisted scene-generation context (platform/aspect/mode/resolution/quality/source/branding/brandIndustry/topic) so one scene can be re-generated on Replace Visual without losing render settings.';
