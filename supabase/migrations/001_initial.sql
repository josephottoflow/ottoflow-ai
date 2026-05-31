-- ============================================================
-- Ottoflow AI — 001 Initial schema (Clerk-compatible)
-- Run in: Supabase Dashboard → SQL Editor (or via supabase db push)
--
-- NOTE: user_id is TEXT because Clerk IDs are strings (user_2abc...),
-- not UUIDs. Clerk-Supabase integration injects the Clerk user id into
-- `auth.jwt() ->> 'sub'` — RLS policies read from there.
-- ============================================================

create extension if not exists "pgcrypto";

-- ─── helper ────────────────────────────────────────────────────────────────────

create or replace function public.current_clerk_user_id()
returns text language sql stable as $$
  select coalesce(
    auth.jwt() ->> 'sub',
    current_setting('request.jwt.claim.sub', true)
  )
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── Projects ──────────────────────────────────────────────────────────────────

create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,
  name          text not null,
  type          text not null check (type in ('content','video')),
  status        text not null default 'active' check (status in ('active','completed','draft','paused')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  content_count int  not null default 0,
  video_count   int  not null default 0,
  tags          text[] not null default '{}',
  credits_used  int  not null default 0
);

create index if not exists projects_user_id_idx on public.projects(user_id);

drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at
  before update on public.projects
  for each row execute procedure public.set_updated_at();

-- ─── Content Items ─────────────────────────────────────────────────────────────

create table if not exists public.content_items (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects(id) on delete cascade,
  platform    text not null check (platform in ('linkedin','facebook','instagram','twitter','blog','email')),
  title       text not null,
  preview     text,
  body        text,
  status      text not null default 'draft' check (status in ('draft','approved','published','scheduled')),
  created_at  timestamptz not null default now(),
  engagement  jsonb
);

create index if not exists content_items_project_id_idx on public.content_items(project_id);
create index if not exists content_items_status_idx     on public.content_items(status);
create index if not exists content_items_created_at_idx on public.content_items(created_at desc);

-- ─── Render Jobs ───────────────────────────────────────────────────────────────

create table if not exists public.render_jobs (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid references public.projects(id) on delete set null,
  name            text not null,
  status          text not null default 'queued' check (status in ('queued','rendering','done','failed')),
  progress        int  not null default 0 check (progress >= 0 and progress <= 100),
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  duration_ms     int,
  template        text not null default 'ugc-v2',
  output_path     text,
  output_url      text,
  error_message   text,
  prompt          text,
  meta            jsonb
);

create index if not exists render_jobs_status_idx     on public.render_jobs(status);
create index if not exists render_jobs_project_id_idx on public.render_jobs(project_id);
create index if not exists render_jobs_started_at_idx on public.render_jobs(started_at desc);

create or replace function public.set_render_duration()
returns trigger language plpgsql as $$
begin
  if new.status = 'done' and new.completed_at is not null and (old.status is distinct from 'done') then
    new.duration_ms = extract(epoch from (new.completed_at - new.started_at)) * 1000;
  end if;
  return new;
end;
$$;

drop trigger if exists render_jobs_duration on public.render_jobs;
create trigger render_jobs_duration
  before update on public.render_jobs
  for each row execute procedure public.set_render_duration();

-- ─── Activity Feed ─────────────────────────────────────────────────────────────

create table if not exists public.activity (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references public.projects(id) on delete set null,
  project_name  text,
  type          text not null check (type in (
    'video_rendered','content_generated','project_created','approval','published','error',
    'brand_researched'
  )),
  message       text not null,
  created_at    timestamptz not null default now(),
  meta          jsonb
);

create index if not exists activity_created_at_idx on public.activity(created_at desc);

-- ─── RLS ───────────────────────────────────────────────────────────────────────

alter table public.projects      enable row level security;
alter table public.content_items enable row level security;
alter table public.render_jobs   enable row level security;
alter table public.activity      enable row level security;

drop policy if exists "projects_owner" on public.projects;
create policy "projects_owner"
  on public.projects for all
  using  (user_id = public.current_clerk_user_id())
  with check (user_id = public.current_clerk_user_id());

drop policy if exists "content_via_project" on public.content_items;
create policy "content_via_project"
  on public.content_items for all
  using (
    project_id in (
      select id from public.projects where user_id = public.current_clerk_user_id()
    )
  );

drop policy if exists "renders_via_project" on public.render_jobs;
create policy "renders_via_project"
  on public.render_jobs for all
  using (
    project_id is null
    or project_id in (
      select id from public.projects where user_id = public.current_clerk_user_id()
    )
  );

drop policy if exists "activity_via_project" on public.activity;
create policy "activity_via_project"
  on public.activity for all
  using (
    project_id is null
    or project_id in (
      select id from public.projects where user_id = public.current_clerk_user_id()
    )
  );

-- ─── Realtime ──────────────────────────────────────────────────────────────────

do $$
begin
  begin
    alter publication supabase_realtime add table public.render_jobs;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.activity;
  exception when duplicate_object then null;
  end;
end $$;
