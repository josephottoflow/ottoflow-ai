-- 008_user_budgets.sql
-- Per-user spend tracking + monthly budget ceiling. Closes R1 from
-- BETA_READINESS_REPORT.
--
-- Two tables:
--   user_budgets:    one row per user. Monthly hard + soft caps in USD.
--                    A nightly cron (or app-side on POST /api/generate)
--                    rolls `current_month_used_usd` to 0 on the 1st.
--   ai_usage_ledger: append-only log of every paid API call. The video
--                    pipeline writes one row per Gemini / ElevenLabs /
--                    Runway / Luma call. Pexels + Jamendo are free so
--                    they don't write rows.
--
-- The ledger is the source of truth — `current_month_used_usd` on
-- user_budgets is a denormalized rollup for fast budget-check queries
-- and is incremented atomically via the increment_user_usage() helper.

CREATE TABLE IF NOT EXISTS user_budgets (
  user_id                   TEXT PRIMARY KEY,
  monthly_hard_cap_usd      NUMERIC NOT NULL DEFAULT 5.00,
  monthly_soft_cap_usd      NUMERIC NOT NULL DEFAULT 3.50,
  current_month_used_usd    NUMERIC NOT NULL DEFAULT 0,
  current_month_start       DATE NOT NULL DEFAULT date_trunc('month', now())::date,
  -- When set to true the user is over the hard cap and POST /api/generate
  -- will reject with 402. Cleared automatically when the month rolls over.
  is_capped                 BOOLEAN NOT NULL DEFAULT false,
  notes                     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_budgets_capped_idx ON user_budgets(is_capped) WHERE is_capped = true;

-- Append-only — every paid call writes one row. Used for billing audit,
-- support investigations, and the per-provider analytics dashboard.
CREATE TABLE IF NOT EXISTS ai_usage_ledger (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL,
  render_job_id     UUID REFERENCES render_jobs(id) ON DELETE SET NULL,
  provider          TEXT NOT NULL,          -- 'gemini' | 'elevenlabs' | 'runway' | 'luma'
  operation         TEXT NOT NULL,          -- e.g. 'generateVideoScript' | 'synthesizeNarration' | 'image_to_video'
  cost_usd          NUMERIC NOT NULL,
  units             NUMERIC,                -- tokens / characters / seconds / clips depending on provider
  unit_type         TEXT,                   -- 'tokens' | 'chars' | 'seconds' | 'clips'
  metadata          JSONB,                  -- raw response excerpt for support
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_ledger_user_id_created_idx ON ai_usage_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_ledger_render_job_idx      ON ai_usage_ledger(render_job_id);
CREATE INDEX IF NOT EXISTS ai_usage_ledger_provider_created_idx ON ai_usage_ledger(provider, created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Users see their own budget + ledger. Worker writes via service_role.
ALTER TABLE user_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_budgets_owner_select" ON user_budgets;
CREATE POLICY "user_budgets_owner_select"
  ON user_budgets FOR SELECT
  USING (user_id = current_clerk_user_id());

DROP POLICY IF EXISTS "ai_usage_ledger_owner_select" ON ai_usage_ledger;
CREATE POLICY "ai_usage_ledger_owner_select"
  ON ai_usage_ledger FOR SELECT
  USING (user_id = current_clerk_user_id());

-- ─── Atomic incrementer ──────────────────────────────────────────────────────
-- Single SQL function that:
--   1. Rolls the month over if we crossed midnight on the 1st
--   2. Appends a ledger row
--   3. Increments current_month_used_usd
--   4. Sets is_capped if we crossed the hard cap
-- All in one tx so a concurrent generation can't double-spend.
CREATE OR REPLACE FUNCTION record_ai_usage(
  p_user_id        TEXT,
  p_render_job_id  UUID,
  p_provider       TEXT,
  p_operation      TEXT,
  p_cost_usd       NUMERIC,
  p_units          NUMERIC DEFAULT NULL,
  p_unit_type      TEXT DEFAULT NULL,
  p_metadata       JSONB DEFAULT NULL
)
RETURNS TABLE (
  current_month_used_usd  NUMERIC,
  is_capped               BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start DATE := date_trunc('month', now())::date;
BEGIN
  -- Upsert: create row at first-spend if missing
  INSERT INTO user_budgets (user_id, current_month_start)
  VALUES (p_user_id, v_month_start)
  ON CONFLICT (user_id) DO NOTHING;

  -- Roll the month forward if the user is in a stale period
  UPDATE user_budgets
     SET current_month_used_usd = 0,
         current_month_start = v_month_start,
         is_capped = false,
         updated_at = now()
   WHERE user_id = p_user_id
     AND current_month_start < v_month_start;

  -- Append ledger row
  INSERT INTO ai_usage_ledger (
    user_id, render_job_id, provider, operation,
    cost_usd, units, unit_type, metadata
  )
  VALUES (
    p_user_id, p_render_job_id, p_provider, p_operation,
    p_cost_usd, p_units, p_unit_type, p_metadata
  );

  -- Atomic increment + cap check
  UPDATE user_budgets
     SET current_month_used_usd = current_month_used_usd + p_cost_usd,
         is_capped = (current_month_used_usd + p_cost_usd) >= monthly_hard_cap_usd,
         updated_at = now()
   WHERE user_id = p_user_id;

  RETURN QUERY
    SELECT b.current_month_used_usd, b.is_capped
      FROM user_budgets b
     WHERE b.user_id = p_user_id;
END;
$$;

-- ─── Realtime so user dashboard reflects spend instantly ─────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'user_budgets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE user_budgets;
  END IF;
END $$;
