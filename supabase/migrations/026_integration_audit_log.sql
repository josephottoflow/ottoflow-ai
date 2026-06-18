-- 026_integration_audit_log.sql
-- Phase 3 (P0) — append-only audit trail for integration security events
-- (connect, disconnect, token refresh, reauth, publish attempts later).
-- Additive. No secrets stored here, so this table follows the standard
-- 016/017 convention: RLS enabled with an owner-SELECT policy; writes go
-- through the service role.

CREATE TABLE IF NOT EXISTS integration_audit_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT NOT NULL,
  provider              TEXT,
  -- Open vocabulary: 'connect' | 'disconnect' | 'token_refresh' |
  -- 'reauth_required' | 'revoke' | 'publish' | 'error' | …
  action                TEXT NOT NULL,
  -- Optional free-text target ("LinkedIn Page: Acme", "Drive folder: Reports").
  target                TEXT,
  -- Survives account deletion (keep the trail) → SET NULL, not CASCADE.
  connected_account_id  UUID REFERENCES connected_accounts(id) ON DELETE SET NULL,
  detail                JSONB NOT NULL DEFAULT '{}',
  ip                    TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary read: "this user's audit events, newest first".
CREATE INDEX IF NOT EXISTS integration_audit_log_user_created_idx
  ON integration_audit_log(user_id, created_at DESC);

-- RLS: owner may read their own audit rows; writes via the service role
-- (route handlers/worker), same pattern as content_metrics in 016.
ALTER TABLE integration_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integration_audit_log_owner_select" ON integration_audit_log;
CREATE POLICY "integration_audit_log_owner_select"
  ON integration_audit_log FOR SELECT
  USING (user_id = public.current_clerk_user_id());
