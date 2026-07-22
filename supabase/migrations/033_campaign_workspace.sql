-- 033_campaign_workspace.sql
-- Campaign Workspace V1. ADDITIVE ONLY, backward-compatible, reversible.
--
-- Evolves the Campaign Execution Engine campaign (migration 030) into the
-- mission-control WORKSPACE — the parent organizational entity of Content Studio.
-- Every new column is nullable or defaulted, so all existing rows AND the
-- campaign-execution worker stay valid. The `status` column is free TEXT (no
-- CHECK constraint), so the new workspace statuses (research / in_progress /
-- scheduled / live / completed / archived) coexist with the execution statuses
-- (planning / generating / review / ready / failed) — nothing to migrate.
--
-- Relationships are added by pointer only (campaign_id), never by duplicating
-- data: content links already exist (content_items.campaign_id,
-- content_creatives.campaign_id from 030); this adds the research-ideas link
-- (brand_topics ARE the research ideas / mined opportunities).

-- ── Workspace metadata on the campaign (all additive) ──────────────────────
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS name             TEXT,
  ADD COLUMN IF NOT EXISTS description      TEXT,
  ADD COLUMN IF NOT EXISTS objective        TEXT,
  ADD COLUMN IF NOT EXISTS owner            TEXT,
  ADD COLUMN IF NOT EXISTS priority         TEXT    NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS target_audience  TEXT,
  ADD COLUMN IF NOT EXISTS channels         TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tags             TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS primary_cta      TEXT,
  ADD COLUMN IF NOT EXISTS success_metrics  TEXT,
  ADD COLUMN IF NOT EXISTS notes            TEXT,
  ADD COLUMN IF NOT EXISTS color            TEXT,
  ADD COLUMN IF NOT EXISTS icon             TEXT,
  ADD COLUMN IF NOT EXISTS is_favorite      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_archived      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS start_date       DATE,
  ADD COLUMN IF NOT EXISTS end_date         DATE;

-- ── Research-ideas linkage (relationship only) ─────────────────────────────
-- brand_topics are the mined research ideas / opportunities (migrations 005 +
-- 013). Nullable FK so every existing topic stays valid; ON DELETE SET NULL so
-- deleting a campaign never deletes research.
ALTER TABLE public.brand_topics
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS brand_topics_campaign_idx ON public.brand_topics(campaign_id);

-- ── Library indexes (favorite / archive filters) ───────────────────────────
CREATE INDEX IF NOT EXISTS campaigns_favorite_idx ON public.campaigns(user_id) WHERE is_favorite;
CREATE INDEX IF NOT EXISTS campaigns_archived_idx ON public.campaigns(user_id, is_archived);

-- ── Rollback (reversible) ──────────────────────────────────────────────────
-- DROP INDEX IF EXISTS campaigns_favorite_idx;
-- DROP INDEX IF EXISTS campaigns_archived_idx;
-- DROP INDEX IF EXISTS brand_topics_campaign_idx;
-- ALTER TABLE public.brand_topics DROP COLUMN IF EXISTS campaign_id;
-- ALTER TABLE public.campaigns
--   DROP COLUMN IF EXISTS name, DROP COLUMN IF EXISTS description,
--   DROP COLUMN IF EXISTS objective, DROP COLUMN IF EXISTS owner,
--   DROP COLUMN IF EXISTS priority, DROP COLUMN IF EXISTS target_audience,
--   DROP COLUMN IF EXISTS channels, DROP COLUMN IF EXISTS tags,
--   DROP COLUMN IF EXISTS primary_cta, DROP COLUMN IF EXISTS success_metrics,
--   DROP COLUMN IF EXISTS notes, DROP COLUMN IF EXISTS color,
--   DROP COLUMN IF EXISTS icon, DROP COLUMN IF EXISTS is_favorite,
--   DROP COLUMN IF EXISTS is_archived, DROP COLUMN IF EXISTS start_date,
--   DROP COLUMN IF EXISTS end_date;
