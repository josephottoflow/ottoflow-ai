-- 030_campaigns.sql
-- Campaign Execution Engine (Sprint 25). Additive only.
--
-- A Campaign is the PARENT of many creative assets: one request → a full,
-- strategically-aligned package (hero, supporting, carousel, quote, video,
-- follow-up, retargeting). The strategy (CampaignStrategy, Sprint 24) and a
-- QA snapshot live in jsonb; assets link back via campaign_id on both
-- content_items and content_creatives (denormalized for direct rollup).
--
-- Status machine: planning → generating → review → ready (or failed). Assets
-- are generated through the EXISTING creative-generation pipeline (one
-- content_creative per asset, enqueued from the campaign-execution worker).

CREATE TABLE IF NOT EXISTS public.campaigns (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  brand_id     UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  title        TEXT,
  -- The request that seeds the campaign ("create a recruitment campaign for…").
  prompt       TEXT NOT NULL,
  platform     TEXT NOT NULL DEFAULT 'linkedin',
  -- planning | generating | review | ready | failed
  status       TEXT NOT NULL DEFAULT 'planning',
  -- CampaignStrategy (objective/audience/awareness/message/emotion/cta/funnel/
  -- distribution/reasoning/package) — the strategist's plan for the whole set.
  strategy     JSONB,
  -- Last computed Campaign QA snapshot (coverage/consistency/diversity/
  -- readiness/overall). Advisory; recomputed on read too.
  qa           JSONB,
  asset_count  INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaigns_brand_idx ON public.campaigns(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS campaigns_user_idx ON public.campaigns(user_id, created_at DESC);

-- Asset linkage (additive, nullable — every existing row stays valid).
ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS campaign_role TEXT;
ALTER TABLE public.content_creatives
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS campaign_role TEXT;

CREATE INDEX IF NOT EXISTS content_creatives_campaign_idx ON public.content_creatives(campaign_id);
CREATE INDEX IF NOT EXISTS content_items_campaign_idx ON public.content_items(campaign_id);

-- RLS: owner read via user_id; writes via service role (the worker + API check
-- ownership explicitly, same pattern as content_creatives / content_metrics).
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaigns_owner_select" ON public.campaigns;
CREATE POLICY "campaigns_owner_select"
  ON public.campaigns FOR SELECT
  USING (user_id = public.current_clerk_user_id());
