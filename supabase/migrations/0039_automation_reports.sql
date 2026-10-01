-- =====================================================================
-- 0039: auto-test reports from the aktrade runner.
--
-- A person clicks "Auto-test this app" in the aktrade Development Portal. The runner
-- tests the whole app (learning from every app's knowledge, past bugs and the
-- client requirements) and sends one report per run:
--   POST /api/automation/reports             -> this row, upserted on (project, run_id)
--   POST /api/automation/reports/<id>/files  -> the Excel workbook and failure
--                                               screenshots, in the private
--                                               `automation-reports` bucket under
--                                               <project id>/<report id>/<name>
-- The report page (project -> Automation -> report) shows it. A finding becomes a bug
-- only when a person clicks "File as bug" (app/api/projects/[projectId]/reports/
-- [reportId]/file-bug), never on arrival.
--
-- Visibility follows the other automation tables (0034, 0036): people who can see
-- the project, except contributor-level roles (developers). All writes go through
-- the service role.
-- =====================================================================

create table if not exists public.automation_reports (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  release_id   uuid references public.releases(id) on delete set null,
  version      text,
  run_id       text not null,
  runner       text,
  platform     text,
  status       text not null default 'complete' check (status in ('complete', 'partial')),
  started_at   timestamptz,
  finished_at  timestamptz,
  cost_usd     numeric,
  summary      jsonb not null default '{}'::jsonb,
  report       jsonb not null default '{}'::jsonb,
  files        jsonb not null default '{}'::jsonb,   -- file name -> storage path
  excel_path   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (project_id, run_id)
);
create index if not exists automation_reports_project_idx
  on public.automation_reports (project_id, created_at desc);

drop trigger if exists trg_automation_reports_updated on public.automation_reports;
create trigger trg_automation_reports_updated before update on public.automation_reports
  for each row execute procedure public.touch_updated_at();

alter table public.automation_reports enable row level security;
drop policy if exists automation_reports_select on public.automation_reports;
create policy automation_reports_select on public.automation_reports
  for select to authenticated
  using (not public.is_contributor() and public.can_see_project(project_id));

-- Storage: private bucket, one folder per project. Read = the same people as the rows.
insert into storage.buckets (id, name, public, file_size_limit)
values ('automation-reports', 'automation-reports', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "autoreports_read" on storage.objects;
create policy "autoreports_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'automation-reports'
    and not public.is_contributor()
    and exists (select 1 from public.projects p
                 where p.id::text = (storage.foldername(name))[1]
                   and public.can_see_project(p.id))
  );
