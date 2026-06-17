-- 027_publishing_destinations.sql
-- Phase 3 Publishing (PUB-1) — first-class targetable destinations
-- (LinkedIn org page, Facebook Page, IG business account, YouTube channel, …).
-- Additive. Write-through cache: connected_accounts.metadata.destinations stays
-- authoritative for discovery in PUB-1; this table is populated write-through
-- (on discovery + resolve-or-create at enqueue). No backfill.
--
-- SECURITY: may hold a per-destination secret (token_enc, e.g. FB Page token),
-- so — like connected_accounts — RLS is enabled with NO client policies
-- (service-role only). The UI does not read this table in PUB-1.

CREATE TABLE IF NOT EXISTS publishing_destinations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT NOT NULL,
  connected_account_id  UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL,
  destination_type      TEXT NOT NULL,   -- 'personal'|'company_page'|'facebook_page'|'ig_business'|'youtube_channel'|…
  destination_id        TEXT NOT NULL,   -- provider urn / page id / channel id
  destination_name      TEXT,
  -- Per-destination OAuth secret (AES-256-GCM envelope). NULL for providers
  -- that publish with the account token (LinkedIn/PUB-1). Never plaintext.
  token_enc             TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One destination row per (account, provider-destination); resolve-or-create upserts.
CREATE UNIQUE INDEX IF NOT EXISTS publishing_destinations_account_dest_uidx
  ON publishing_destinations(connected_account_id, destination_id);
CREATE INDEX IF NOT EXISTS publishing_destinations_user_provider_idx
  ON publishing_destinations(user_id, provider);

DROP TRIGGER IF EXISTS publishing_destinations_updated_at ON publishing_destinations;
CREATE TRIGGER publishing_destinations_updated_at
  BEFORE UPDATE ON publishing_destinations
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- RLS: enabled, NO client policies → service-role only (holds token_enc).
ALTER TABLE publishing_destinations ENABLE ROW LEVEL SECURITY;
