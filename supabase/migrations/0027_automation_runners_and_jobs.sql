-- Route automation by platform: Android tests -> the Windows runner, iOS tests -> the Mac runner.
-- Runners pull work outbound-only; the portal never connects to them.

create table public.automation_runners (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  platform     text not null check (platform in ('android', 'ios')),
  os           text not null check (os in ('windows', 'macos', 'linux')),
  status       text not null default 'idle',
  app_version  text,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  -- The rule this whole feature exists for: Android runs on Windows, iOS on a Mac.
  constraint runner_platform_matches_os check (
    (platform = 'android' and os = 'windows') or (platform = 'ios' and os = 'macos')
  )
);

create table public.test_jobs (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  platform        text not null check (platform in ('android', 'ios')),
  kind            text not null default 'bug' check (kind in ('bug', 'source_coverage')),
  bug_id          uuid references public.bugs(id) on delete set null,
  status          text not null default 'queued'
                  check (status in ('queued', 'claimed', 'generated', 'failed', 'cancelled')),
  runner_id       uuid references public.automation_runners(id) on delete set null,
  note            text,
  generated_tests jsonb not null default '[]'::jsonb,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  completed_at    timestamptz
);
-- A bug can't be queued twice while a job for it is still active.
create unique index test_jobs_one_active_per_bug on public.test_jobs(bug_id)
  where bug_id is not null and status in ('queued', 'claimed');
create index test_jobs_queue_idx on public.test_jobs(platform, status, created_at);
create index test_jobs_project_idx on public.test_jobs(project_id);

-- Atomically hands the oldest queued job for a platform to a runner. `skip locked`
-- means two runners (or one runner polling twice) never get the same job.
create or replace function public.claim_test_job(p_platform text, p_runner_id uuid)
returns setof public.test_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from automation_runners where id = p_runner_id and platform = p_platform) then
    raise exception 'runner % is not registered for platform %', p_runner_id, p_platform;
  end if;
  select id into v_id from test_jobs
    where platform = p_platform and status = 'queued'
    order by created_at
    for update skip locked
    limit 1;
  if v_id is null then
    return;
  end if;
  return query
    update test_jobs
       set status = 'claimed', runner_id = p_runner_id, claimed_at = now()
     where id = v_id
    returning *;
end;
$$;
revoke all on function public.claim_test_job(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_test_job(text, uuid) to service_role;

-- Reads for signed-in users; runner writes go through the service role.
alter table public.automation_runners enable row level security;
alter table public.test_jobs enable row level security;

create policy automation_runners_select on public.automation_runners
  for select to authenticated using (true);
create policy test_jobs_select on public.test_jobs
  for select to authenticated using (true);
-- QA/admin create and cancel jobs from the portal; the job's platform must be its project's.
create policy test_jobs_insert on public.test_jobs
  for insert to authenticated
  with check (
    public.is_qa_or_admin()
    and platform = (select p.platform from public.projects p where p.id = project_id)
  );
create policy test_jobs_update on public.test_jobs
  for update to authenticated using (public.is_qa_or_admin()) with check (public.is_qa_or_admin());
