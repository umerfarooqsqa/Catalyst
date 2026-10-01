-- =====================================================================
-- 0036: automation is not shown to developers.
-- The Automation page and each project's Automation tab are hidden from
-- contributor-level roles (lib/permissions.ts canSeeAutomation). Here the data
-- behind them is closed too: the runner folders (project_automation), the
-- runners, and the automation jobs. Other roles keep 0034's platform rule.
-- Automation writes use the service role and are unaffected.
-- =====================================================================

create or replace function public.is_contributor()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select r.level = 'contributor'
       from public.profiles p join public.roles r on r.key = p.role
       where p.id = auth.uid()), false) $$;
grant execute on function public.is_contributor() to authenticated;

drop policy if exists project_automation_select on public.project_automation;
create policy project_automation_select on public.project_automation
  for select to authenticated
  using (not public.is_contributor() and public.can_see_project(project_id));

drop policy if exists test_jobs_select on public.test_jobs;
create policy test_jobs_select on public.test_jobs
  for select to authenticated
  using (not public.is_contributor() and public.can_see_project(project_id));

drop policy if exists automation_runners_select on public.automation_runners;
create policy automation_runners_select on public.automation_runners
  for select to authenticated
  using (not public.is_contributor());
