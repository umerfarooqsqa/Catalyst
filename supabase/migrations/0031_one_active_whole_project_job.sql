-- "Automate the whole project" = a `source_coverage` job (no bug). A project may have only one of them
-- active (queued/claimed) at a time; bug jobs are already limited to one active job per bug (0027).
create unique index test_jobs_one_active_project_job on public.test_jobs(project_id)
  where kind = 'source_coverage' and status in ('queued', 'claimed');
