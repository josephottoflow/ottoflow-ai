-- ============================================================
-- Ottoflow AI — 002 Foundation: Brands + Research engine
-- Adds the Brand Research domain on top of 001.
-- ============================================================

-- ─── Brands ────────────────────────────────────────────────────────────────────

create table if not exists public.brands (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,
  name          text not null,
  website       text,
  industry      text,
  -- 'pending' = no research yet, 'researching' = job in flight,
  -- 'ready' = research succeeded, 'failed' = research errored
  status        text not null default 'pending'
                check (status in ('pending','researching','ready','failed')),
  -- Full BrandProfile JSON written by the research worker.
  -- Shape lives in src/lib/types.ts (BrandProfile).
  profile       jsonb,
  -- Brand-asset hooks (colors/logos populated later by Brand Asset Manager)
  brand_colors  jsonb,
  logo_url      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists brands_user_id_idx on public.brands(user_id);
create index if not exists brands_status_idx  on public.brands(status);

drop trigger if exists brands_updated_at on public.brands;
create trigger brands_updated_at
  before update on public.brands
  for each row execute procedure public.set_updated_at();

-- ─── Brand Research Jobs ───────────────────────────────────────────────────────
-- One row per research run for a brand. Worker streams updates here;
-- the UI subscribes via Supabase Realtime.

create table if not exists public.brand_research_jobs (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.brands(id) on delete cascade,
  status        text not null default 'queued'
                check (status in ('queued','running','done','failed')),
  current_step  text,            -- e.g. 'fetching_site', 'extracting_profile'
  progress      int not null default 0 check (progress between 0 and 100),
  logs          jsonb not null default '[]'::jsonb,
  error_message text,
  bull_job_id   text,            -- BullMQ job id (for cancellation / debugging)
  started_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create index if not exists brand_research_jobs_brand_id_idx on public.brand_research_jobs(brand_id);
create index if not exists brand_research_jobs_status_idx   on public.brand_research_jobs(status);

-- Atomically append a log entry (called from the worker).
create or replace function public.append_research_log(
  job_id uuid,
  entry  jsonb
) returns void language sql as $$
  update public.brand_research_jobs
     set logs = logs || jsonb_build_array(entry)
   where id = job_id;
$$;

-- ─── Competitors ───────────────────────────────────────────────────────────────

create table if not exists public.competitors (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.brands(id) on delete cascade,
  name          text not null,
  website       text,
  summary       text,
  source        text,             -- where we found them (e.g. 'google_search')
  positioning   text,
  strengths     text[] not null default '{}',
  weaknesses    text[] not null default '{}',
  created_at    timestamptz not null default now()
);

create index if not exists competitors_brand_id_idx on public.competitors(brand_id);

-- ─── Keywords ──────────────────────────────────────────────────────────────────

create table if not exists public.keywords (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references public.brands(id) on delete cascade,
  term              text not null,
  -- 'informational', 'commercial', 'transactional', 'navigational'
  intent            text,
  search_volume     int,
  competition_score numeric(4,2),  -- 0.00–1.00
  trend_score       numeric(4,2),
  relevance_score   numeric(4,2),
  opportunity_score numeric(4,2),
  created_at        timestamptz not null default now()
);

create index if not exists keywords_brand_id_idx          on public.keywords(brand_id);
create index if not exists keywords_opportunity_score_idx on public.keywords(opportunity_score desc);

-- ─── Content Pillars ───────────────────────────────────────────────────────────

create table if not exists public.content_pillars (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brands(id) on delete cascade,
  name            text not null,
  description     text,
  content_types   text[] not null default '{}', -- ['blog','reel','short','tiktok','linkedin']
  example_topics  text[] not null default '{}',
  priority        int not null default 0,        -- 0 = highest
  created_at      timestamptz not null default now()
);

create index if not exists content_pillars_brand_id_idx on public.content_pillars(brand_id);

-- ─── Wire brands -> projects ───────────────────────────────────────────────────

alter table public.projects
  add column if not exists brand_id uuid references public.brands(id) on delete set null;

create index if not exists projects_brand_id_idx on public.projects(brand_id);

-- ─── RLS ───────────────────────────────────────────────────────────────────────

alter table public.brands               enable row level security;
alter table public.brand_research_jobs  enable row level security;
alter table public.competitors          enable row level security;
alter table public.keywords             enable row level security;
alter table public.content_pillars      enable row level security;

drop policy if exists "brands_owner" on public.brands;
create policy "brands_owner"
  on public.brands for all
  using  (user_id = public.current_clerk_user_id())
  with check (user_id = public.current_clerk_user_id());

-- Helper: child rows are visible via their brand
drop policy if exists "research_jobs_via_brand" on public.brand_research_jobs;
create policy "research_jobs_via_brand"
  on public.brand_research_jobs for all
  using (
    brand_id in (
      select id from public.brands where user_id = public.current_clerk_user_id()
    )
  );

drop policy if exists "competitors_via_brand" on public.competitors;
create policy "competitors_via_brand"
  on public.competitors for all
  using (
    brand_id in (
      select id from public.brands where user_id = public.current_clerk_user_id()
    )
  );

drop policy if exists "keywords_via_brand" on public.keywords;
create policy "keywords_via_brand"
  on public.keywords for all
  using (
    brand_id in (
      select id from public.brands where user_id = public.current_clerk_user_id()
    )
  );

drop policy if exists "pillars_via_brand" on public.content_pillars;
create policy "pillars_via_brand"
  on public.content_pillars for all
  using (
    brand_id in (
      select id from public.brands where user_id = public.current_clerk_user_id()
    )
  );

-- ─── Realtime: stream research-job updates to the UI ───────────────────────────

do $$
begin
  begin
    alter publication supabase_realtime add table public.brand_research_jobs;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.brands;
  exception when duplicate_object then null;
  end;
end $$;
