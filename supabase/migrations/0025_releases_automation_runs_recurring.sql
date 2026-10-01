-- Phase 6: releases, automation runs, recurring-bug tracking, completion-email recipients.
-- "House" = a catalyst project with house_slug (the Android project); releases hang off it.

alter table public.projects add column notify_emails text[] not null default '{}';
comment on column public.projects.notify_emails is
  'REQ-13: recipients of the release-completion email for this house. Copied onto each release when it is created.';

create table public.releases (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  version          text not null,
  release_notes_ref text,
  status           text not null default 'in_progress' check (status in ('in_progress', 'done')),
  notify_emails    text[] not null default '{}',
  discrepancies    jsonb not null default '[]'::jsonb,
  started_at       timestamptz not null default now(),
  completed_at     timestamptz,
  unique (project_id, version)
);

create table public.automation_runs (
  id                uuid primary key default gen_random_uuid(),
  release_id        uuid not null references public.releases(id) on delete cascade,
  run_id            text not null,
  suite             text not null default 'mixed',
  passed            integer not null default 0,
  failed            integer not null default 0,
  broken            integer not null default 0,
  skipped           integer not null default 0,
  excel_report_path text,
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (release_id, run_id)
);
create index automation_runs_release_idx on public.automation_runs(release_id);

-- Reads for signed-in users (same visibility as projects); all writes come from
-- the automation ingestion API via the service role, so no write policies.
alter table public.releases enable row level security;
alter table public.automation_runs enable row level security;
create policy "releases_select" on public.releases for select to authenticated using (true);
create policy "automation_runs_select" on public.automation_runs for select to authenticated using (true);

-- Bugs raised/updated by automation: a stable key (the failing test's node id)
-- lets a repeat failure find its existing bug instead of filing a duplicate.
alter table public.bugs add column source text not null default 'manual' check (source in ('manual', 'automation'));
alter table public.bugs add column automation_key text;
alter table public.bugs add column release_id uuid references public.releases(id) on delete set null;
alter table public.bugs add column recurring boolean not null default false;
alter table public.bugs add column occurrences integer not null default 1;
create unique index bugs_project_automation_key_idx on public.bugs(project_id, automation_key) where automation_key is not null;

-- Bug Library entries scoped to a house (master_bug rows keep project_id null,
-- so the house lives in its own column), plus how often it has recurred.
alter table public.base_page add column house_slug text;
alter table public.base_page add column recurring_count integer not null default 0;
create index base_page_house_slug_idx on public.base_page(house_slug);
