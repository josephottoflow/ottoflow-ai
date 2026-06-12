-- 017_brand_assets.sql
-- Brand Creative Orchestrator — Phase A: reusable brand asset library.
-- Additive only. One table + one storage bucket.
--
-- brand_assets stores user-uploaded LOCKED assets (logos, founder headshots,
-- product shots). Safety contract enforced in code, recorded here for the
-- next reader:
--   1. Original bytes are IMMUTABLE — never modified after upload.
--   2. Asset bytes are NEVER sent to any AI model.
--   3. The Phase C compositor may only resize/crop/mask/position them —
--      no enhancement, recoloring, stylization, or regeneration.
-- The upload route decodes the image (sharp metadata, read-only) purely to
-- verify it IS an image and to record width/height/has_alpha for layout math.

CREATE TABLE IF NOT EXISTS brand_assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  -- 'product' exists for the deferred product_led hierarchy; uploads are
  -- accepted now so the library is ready when that hierarchy lands.
  kind          TEXT NOT NULL CHECK (kind IN ('logo','headshot','product')),
  -- Free-text label, e.g. "Primary logo (dark bg)" or "Jane Doe — Founder".
  -- For headshots the label is the source of the person's display name used
  -- in creative briefs (founder_name_usage).
  label         TEXT,
  storage_path  TEXT NOT NULL,
  public_url    TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  byte_size     INTEGER NOT NULL CHECK (byte_size > 0),
  width         INTEGER,
  height        INTEGER,
  has_alpha     BOOLEAN,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brand_assets_brand_kind_idx
  ON brand_assets(brand_id, kind);

-- RLS: owner-read via brand → user; writes via service role (the upload
-- route checks ownership explicitly, same pattern as research_documents).
ALTER TABLE brand_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brand_assets_owner_select" ON brand_assets;
CREATE POLICY "brand_assets_owner_select"
  ON brand_assets FOR SELECT
  USING (
    brand_id IN (
      SELECT id FROM brands WHERE user_id = current_clerk_user_id()
    )
  );

-- ─── Storage bucket: brand-assets ────────────────────────────────────────────
-- Public-read bucket (same pattern as merged-videos in 004): object paths are
-- uuid-based and unguessable; writes go through the service-role key only.
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Public read on brand-assets" ON storage.objects;
CREATE POLICY "Public read on brand-assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'brand-assets');
