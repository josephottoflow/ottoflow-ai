-- 025_oauth_states.sql
-- Phase 3 (P0) — short-lived OAuth handshake state for the Authorization-Code
-- + PKCE flow. Additive. Server-only: a row is created at /connect and
-- consumed (then deleted) at /callback. Holds the CSRF `state` and the
-- encrypted PKCE code_verifier — so, like connected_accounts, RLS is enabled
-- with NO client policies (service-role only). Rows are ephemeral (minutes).

CREATE TABLE IF NOT EXISTS oauth_states (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Opaque CSRF token echoed back by the provider on the callback.
  state              TEXT NOT NULL,
  user_id            TEXT NOT NULL,
  provider           TEXT NOT NULL,
  -- PKCE verifier, AES-256-GCM envelope (never plaintext). NULL for providers
  -- without PKCE.
  code_verifier_enc  TEXT,
  -- Exact redirect URI used, re-sent at token exchange (must match the grant).
  redirect_uri       TEXT,
  -- Optional brand the connect flow was initiated for (carried to the account).
  brand_id           UUID REFERENCES brands(id) ON DELETE SET NULL,
  metadata           JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Hard TTL; the callback rejects expired rows and a sweep deletes them.
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes')
);

-- Callback lookup is by `state`; it must be unique to be a valid CSRF nonce.
CREATE UNIQUE INDEX IF NOT EXISTS oauth_states_state_uidx
  ON oauth_states(state);

-- Expiry sweep read.
CREATE INDEX IF NOT EXISTS oauth_states_expires_at_idx
  ON oauth_states(expires_at);

-- RLS: enabled, NO client policies → service-role only (holds the PKCE
-- verifier and is purely a server-side handshake artifact).
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
