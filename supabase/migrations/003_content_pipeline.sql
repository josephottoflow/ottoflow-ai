-- ============================================================================
-- 003 — Content Generation Pipeline
-- ============================================================================
--
-- Adds the job-tracking table for content generation, mirroring the
-- brand_research_jobs pattern. Content items themselves already exist in
-- public.content_items (001_initial); this migration only adds the
-- generation-job side-table + an index for ordering, plus a SQL-side log
-- append helper.
--
-- Wire vs. brand-research:
--   brand_research_jobs → brand_id → brands
--   content_generation_jobs → brand_id → brands, content_item_id → content_items
--
-- The content_item row is created BEFORE the worker job runs so the user has
-- something to refer to in URLs while the body is still null. The job row
-- carries the progress + logs; the content_item row eventually carries the
-- generated title/preview/body.
-- ============================================================================

-- ─── content_generation_jobs ─────────────────────────────────────────────────
create table if not exists public.content_generation_jobs (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references public.brands(id) on delete cascade,
  content_item_id  uuid references public.content_items(id) on delete cascade,
  status           text not null default 'queued'
                   check (status in ('queued','running','done','failed')),
  current_step     text,     -- 'preparing_prompt' | 'generating' | 'finalizing'
  progress         int not null default 0 check (progress between 0 and 100),
  logs             jsonb not null default '[]'::jsonb,
  error_message    text,
  bull_job_id      text,
  -- The user inputs we want to replay if they retry the same job
  platform         text not null,
  user_prompt      text,
  pillar_id        uuid,    -- optional content_pillars reference
  started_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create index if not exists content_generation_jobs_brand_id_idx
  on public.content_generation_jobs(brand_id);
create index if not exists content_generation_jobs_content_item_id_idx
  on public.content_generation_jobs(content_item_id);
create index if not exists content_generation_jobs_status_idx
  on public.content_generation_jobs(status);
create index if not exists content_generation_jobs_started_at_idx
  on public.content_generation_jobs(started_at desc);

-- SQL-side log appender. Same shape as append_research_log in 002 so the
-- worker code can reuse the helper pattern without read-modify-write races.
create or replace function public.append_content_log(
  job_id uuid,
  entry  jsonb
) returns void language sql as $$
  update public.content_generation_jobs
     set logs = logs || jsonb_build_array(entry)
   where id = job_id;
$$;

-- ─── Make content_items.project_id nullable + add brand_id direct link ───────
--
-- The original schema (001) made every content item belong to a project.
-- For the MVP content pipeline we want users to generate content directly
-- against a brand without first creating a project — so loosen the FK and
-- add a brand_id pointer.
alter table public.content_items
  add column if not exists brand_id uuid references public.brands(id) on delete cascade;

alter table public.content_items
  add column if not exists user_prompt text;

create index if not exists content_items_brand_id_idx on public.content_items(brand_id);

-- ─── RLS for the new table (mirror brand_research_jobs) ──────────────────────
alter table public.content_generation_jobs enable row level security;

drop policy if exists "owner reads own content jobs" on public.content_generation_jobs;
create policy "owner reads own content jobs" on public.content_generation_jobs
  for select using (
    exists (
      select 1 from public.brands b
      where b.id = content_generation_jobs.brand_id
        and b.user_id = public.current_clerk_user_id()
    )
  );

-- ─── RLS for content_items via brand_id link ─────────────────────────────────
-- The original schema had only project_id (also user-scoped); now that we
-- allow direct brand_id linkage we need a policy that accepts either path.
alter table public.content_items enable row level security;

drop policy if exists "owner reads own content items" on public.content_items;
create policy "owner reads own content items" on public.content_items
  for select using (
    -- Via brand_id (new MVP flow)
    (brand_id is not null and exists (
      select 1 from public.brands b
      where b.id = content_items.brand_id
        and b.user_id = public.current_clerk_user_id()
    ))
    or
    -- Via project_id (legacy / future project flow)
    (project_id is not null and exists (
      select 1 from public.projects p
      where p.id = content_items.project_id
        and p.user_id = public.current_clerk_user_id()
    ))
  );

-- Worker writes via admin client (service role bypasses RLS by design),
-- so we don't need an INSERT/UPDATE policy. The user-side only ever reads.
