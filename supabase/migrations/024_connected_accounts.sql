-- 024_connected_accounts.sql
-- Phase 3 (P0) — Integrations foundation: one row per OAuth-connected
-- external account (Google Drive, LinkedIn, Meta, …). Additive; no existing
-- table touched.
--
-- Ownership: user_id (Clerk id) — Ottoflow has no workspace/tenant table, so
-- the USER is the isolation boundary (same model as brands.user_id). brand_id
-- is an OPTIONAL link for per-brand destinations; NULL = account is available
-- to all of the user's brands. workspace_id is reserved NULL for forward-compat
-- with a future workspace abstraction and is unused in P0.
--
-- SECURITY (deviates intentionally from the 016/017 "owner-SELECT on the base
-- table" convention): this table holds encrypted OAuth tokens. RLS is enabled
-- with NO client policies, so the anon/authenticated Supabase clients can read
-- NOTHING here — only the service-role key (worker + route handlers, which do
-- explicit ownership checks) bypasses RLS. The UI reads connection status via
-- the token-free `connected_accounts_safe` view below. Tokens are encrypted at
-- the app layer (src/lib/integrations/encryption.ts, AES-256-GCM) BEFORE insert
-- and are never sent to the browser.

CREATE TABLE IF NOT EXISTS connected_accounts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT NOT NULL,
  -- Optional per-brand scoping; NULL = usable by all of the user's brands.
  brand_id           UUID REFERENCES brands(id) ON DELETE SET NULL,
  -- Reserved for a future workspace abstraction (Phase 3 ships user-scoped).
  workspace_id       TEXT,
  -- Open vocabulary: 'google_drive' | 'linkedin' | 'facebook' | 'instagram' |
  -- 'x' | 'tiktok' | 'youtube' | 'gmail' | 'outlook' | 'dropbox' | 'onedrive'.
  provider           TEXT NOT NULL,
  -- Provider's stable account identifier (sub / urn / page id).
  account_id         TEXT NOT NULL,
  -- Human label for the UI ("jane@acme.com", "Acme Co. (LinkedIn Page)").
  account_name       TEXT,
  -- AES-256-GCM envelopes (v1.iv.tag.ct). NEVER plaintext, never to client.
  access_token_enc   TEXT,
  refresh_token_enc  TEXT,
  token_expiry       TIMESTAMPTZ,
  scopes             TEXT[] NOT NULL DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','reauth_required','revoked','error')),
  metadata           JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One connection per (user, provider, external account); reconnect upserts.
CREATE UNIQUE INDEX IF NOT EXISTS connected_accounts_user_provider_account_uidx
  ON connected_accounts(user_id, provider, account_id);

-- Primary read path: "this user's connections, optionally by provider".
CREATE INDEX IF NOT EXISTS connected_accounts_user_provider_idx
  ON connected_accounts(user_id, provider);

-- updated_at maintained by the shared trigger (defined in 001_initial.sql).
DROP TRIGGER IF EXISTS connected_accounts_updated_at ON connected_accounts;
CREATE TRIGGER connected_accounts_updated_at
  BEFORE UPDATE ON connected_accounts
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- RLS: enabled, NO client policies → only the service role can touch this
-- table (it holds secrets). Route handlers/worker enforce ownership in code.
ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;

-- NOTE (P0): no client-facing read path is created here. Because RLS is
-- enabled with no policies, anon/authenticated clients can read nothing —
-- which is the intent for a token-bearing table. The UI's connection-status
-- read (a token-free, owner-scoped projection) is added in P1 alongside the
-- Integrations UI, as a service-role-backed route OR a SECURITY DEFINER view
-- with explicit GRANTs — deferred so P0 ships no half-wired access path.
