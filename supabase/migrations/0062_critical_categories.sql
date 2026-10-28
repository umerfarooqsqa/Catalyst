-- =====================================================================
-- 0062: only the Critical section is emailed (2026-10-28, the user's list)
--
-- The user: "only write these categories of bugs in critical section and only critical
-- section should be emailed":
--   A. Play policy / suspension   (app_suspended; a serious Play Console email, play_email)
--   B. Target API compliance      (target_api)
--   C. Crash/ANR rate over limit  (crash_rate, anr_rate, crash_rate_device, anr_rate_device)
--   D. New crash or ANR in the live build (new_crash)
--   F. Critical bugs open on live versions (critical_bugs_live)
-- each only while red (severity critical). Every other warning (untested live build, version
-- mismatch, rejected/halted release, wake locks, "checks have stopped", amber ones, the
-- monitor's own notes) stays a card in Not critical / Negligible with no bell and no email.
--
-- My Queue files cards with the same list (lib/monitor/levels.ts CRITICAL_KINDS): keep the two
-- in step. The bell follows the email so the counts stay equal (the user's earlier report).
-- A Play mail naming no app rings only when serious (lib/monitor/play-mail.ts).
-- =====================================================================

create or replace function public.app_warning_is_critical(p_kind text, p_severity text)
returns boolean
language sql immutable
set search_path = public
as $$
  select p_severity = 'critical'
     and p_kind in ('app_suspended', 'play_email',                                   -- A
                    'target_api',                                                    -- B
                    'crash_rate', 'anr_rate', 'crash_rate_device', 'anr_rate_device', -- C
                    'new_crash',                                                     -- D
                    'critical_bugs_live');                                           -- F
$$;
grant execute on function public.app_warning_is_critical(text, text) to authenticated, service_role;

create or replace function public.app_warning_notify(p_id uuid, p_event text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  w public.app_warnings;
  v_project public.projects;
  v_item jsonb;
  r record;
begin
  select * into w from public.app_warnings where id = p_id;
  -- only the Critical section (A-F, app_warning_is_critical) rings and is emailed (0062)
  if not public.app_warning_is_critical(w.kind, w.severity) or w.source like 'monitor%' then
    return;
  end if;
  select * into v_project from public.projects where id = w.project_id;
  v_item := jsonb_build_object(
    'id', w.id, 'ref', 'APP', 'title', w.title, 'project', v_project.name, 'project_id', v_project.id,
    'severity', w.severity, 'status', case when p_event = 'reopened' then 'reopened' else 'open' end,
    'event', 'app_warning',
    'link', rtrim(public.email_config('email_app_url', 'https://catalyst.umerfarooqsqa.workers.dev'), '/')
            || '/my-queue#w-' || w.id);
  for r in
    select pr.id as user_id
      from public.profiles pr join public.roles ro on ro.key = pr.role
     where 'app_health' = any (pr.skills)
       and (ro.platform is null or ro.platform = v_project.platform)
  loop
    begin
      insert into public.notifications (user_id, type, message, related_warning_id)
      values (r.user_id, 'app_warning',
              v_project.name || ': ' || w.title || case when p_event = 'reopened' then ' (again)' else '' end,
              w.id);
      perform public.app_warning_email(r.user_id, v_item);
    exception when others then
      raise warning 'app_warning_notify failed for % / user %: %', p_id, r.user_id, sqlerrm;
    end;
  end loop;
  update public.app_warnings set notified_at = now() where id = p_id;
end;
$$;
revoke all on function public.app_warning_notify(uuid, text) from public, anon, authenticated;
