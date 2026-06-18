-- 022_video_v1.sql
-- Ottoflow Video V1 (Seedance scene generation + FFmpeg assembly).
-- ADDITIVE ONLY. Every column is nullable; no data backfill; no drops.
-- Idempotent (ADD COLUMN IF NOT EXISTS) so a re-run is safe.
--
-- Preserves ADR-002: reuses render_jobs + scene_generations (migrations 009,
-- 007). Seedance is a scene PROVIDER recorded in scene_generations.provider
-- ('seedance'); FFmpeg remains the composition engine. No table is replaced.

-- ─── render_jobs — video-strategy + AI-first markers ─────────────────────────
-- video_strategy : frozen VideoStrategy object (concept/tension/metaphor/
--                  worldview/scenes[]) for replay + analytics. Mirrors the
--                  still-creative brief so image + video share one thesis.
-- render_kind    : 'stock' (legacy ADR-002 path) | 'ai-first' (Seedance V1).
-- scene_provider : dominant provider for the job, e.g. 'seedance' (analytics).
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS video_strategy JSONB;
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS render_kind    TEXT;
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS scene_provider TEXT;

-- ─── scene_generations — durable storage of the generated clip ───────────────
-- Seedance/Runway/Luma output URLs are ephemeral (Seedance expires ~1h), so the
-- worker copies each clip to R2 and records the durable location here. The
-- existing clip_url stays as the (possibly-expired) provider URL for audit.
-- seed is TEXT per spec (providers vary: int seeds, hashes, or composite ids).
ALTER TABLE scene_generations ADD COLUMN IF NOT EXISTS storage_url TEXT;
ALTER TABLE scene_generations ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE scene_generations ADD COLUMN IF NOT EXISTS seed        TEXT;

-- scene_generations.provider is free-text TEXT (007) → the value 'seedance'
-- needs no schema change.

-- ─── Analytics index ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS render_jobs_render_kind_idx ON render_jobs(render_kind);
