-- 028_publish_jobs.sql
-- Phase 3 Publishing (PUB-1) — per-destination publish job (fan-out: one
-- content item → N jobs). The publish source of truth. Additive.
--
-- No secrets here (tokens live in connected_accounts / publishing_destinations),
-- so standard RLS: owner-SELECT + service-role writes. Destination fields are
-- DENORMALIZED snapshots so a job stays forensically valid if the destination
-- is later edited/disconnected. attempts is a capped jsonb history (no separate
-- publish_attempts table). FKs ON DELETE SET NULL preserve published-post
-- records when a content item / destination is removed.

CREATE TABLE IF NOT EXISTS publish_jobs (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    TEXT NOT NULL,
  content_item_id            UUID REFERENCES content_items(id) ON DELETE SET NULL,
  creative_id                UUID REFERENCES content_creatives(id) ON DELETE SET NULL,
  render_job_id              UUID REFERENCES render_jobs(id) ON DELETE SET NULL,
  publishing_destination_id  UUID REFERENCES publishing_destinations(id) ON DELETE SET NULL,
  connected_account_id       UUID REFERENCES connected_accounts(id) ON DELETE SET NULL,
  -- Denormalized destination snapshot (forensic stability):
  provider                   TEXT NOT NULL,
  destination_type           TEXT,
  destination_id             TEXT NOT NULL,
  destination_name           TEXT,
  status                     TEXT NOT NULL DEFAULT 'queued'
                               CHECK (status IN ('scheduled','queued','publishing','published','failed','canceled','needs_review')),
  scheduled_for              TIMESTAMPTZ,
  claimed_at                 TIMESTAMPTZ,
  published_at               TIMESTAMPTZ,
  external_post_id           TEXT,
  permalink_url              TEXT,
  failure_reason             TEXT,         -- sanitized
  attempt_count              INTEGER NOT NULL DEFAULT 0,
  attempts                   JSONB NOT NULL DEFAULT '[]',   -- capped history (last ~10)
  media_spec                 JSONB NOT NULL DEFAULT '{}',
  client_request_id          TEXT,
  analytics_snapshot         JSONB NOT NULL DEFAULT '{}',   -- reserved (PUB-5)
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- In-flight dedupe: at most one non-terminal job per (content item, destination);
-- allows a fresh job once the prior is terminal (published/failed/canceled).
CREATE UNIQUE INDEX IF NOT EXISTS publish_jobs_inflight_uidx
  ON publish_jobs(content_item_id, publishing_destination_id)
  WHERE status IN ('scheduled','queued','publishing');

-- Enqueue HTTP-retry dedupe.
CREATE UNIQUE INDEX IF NOT EXISTS publish_jobs_client_request_uidx
  ON publish_jobs(client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Scheduler claim-sweep read.
CREATE INDEX IF NOT EXISTS publish_jobs_scheduled_idx
  ON publish_jobs(status, scheduled_for)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS publish_jobs_user_created_idx
  ON publish_jobs(user_id, created_at DESC);

DROP TRIGGER IF EXISTS publish_jobs_updated_at ON publish_jobs;
CREATE TRIGGER publish_jobs_updated_at
  BEFORE UPDATE ON publish_jobs
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- RLS: owner-read; writes via service role (route handlers + worker).
ALTER TABLE publish_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "publish_jobs_owner_select" ON publish_jobs;
CREATE POLICY "publish_jobs_owner_select"
  ON publish_jobs FOR SELECT
  USING (user_id = public.current_clerk_user_id());
