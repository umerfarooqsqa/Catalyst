-- Links a catalyst project to its automation folder on the runner machine (projects/<platform>/<house>/ in the
-- aktrade repo) and shows what is in it. The runner reports this; the portal only displays it.
create table public.project_automation (
  project_id      uuid primary key references public.projects(id) on delete cascade,
  runner_name     text,
  folder          text not null,
  tests_total     integer not null default 0,
  tests_approved  integer not null default 0,
  tests_pending   integer not null default 0,
  last_run_at     timestamptz,
  last_synced_at  timestamptz not null default now()
);

-- Reads for signed-in users; writes come from the runner through the service role.
alter table public.project_automation enable row level security;
create policy project_automation_select on public.project_automation
  for select to authenticated using (true);
