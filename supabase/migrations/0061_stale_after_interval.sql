-- =====================================================================
-- 0061: "checks have stopped" no longer fires for healthy vitals checks (2026-10-28)
--
-- Found by the user ("the cards I see and the emails I get are not equal in amount") and
-- measured on the live data: of the 255 app-warning email items since 0060, 234 were
-- "Android vitals checks have stopped". The sweep called a check stale after stale_minutes
-- (180) without a success, but vitals run every vitals_minutes (360), so every app's vitals
-- card opened 3 h after each good run, emailed, closed itself at the next run ("the check
-- works again") and reopened 3 h later: an email per app every 6 hours for a card that was
-- gone again by the time it was read.
--
-- Now a check is stale after its own interval plus stale_minutes (vitals 9 h, Play 4 h with
-- the defaults). The next sweep closes the 60 false cards by itself (monitor cards close
-- themselves when no longer true, 0060); real ones (no success for that long) stay.
-- =====================================================================

create or replace function public.app_monitor_sweep()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  cfg public.app_monitor_config;
  r record;
  v_items jsonb;
  v_due int;
  v_unadopted int;
  v_keys int;
begin
  select * into cfg from public.app_monitor_config;
  if not cfg.enabled then
    return;
  end if;
  for r in
    select c.project_id, c."check", c.last_ok_at, c.last_error, c.created_at
      from public.app_monitor_checks c
  loop
    -- stale = no success for the check's own interval plus stale_minutes (was stale_minutes alone,
    -- shorter than the 6-hour vitals interval, so every app's vitals "stopped" 3 h out of every 6)
    if coalesce(r.last_ok_at, r.created_at) < now() - make_interval(mins => cfg.stale_minutes
         + case when r."check" = 'vitals' then cfg.vitals_minutes else cfg.play_minutes end) then
      v_items := jsonb_build_array(jsonb_build_object(
        'kind', 'monitor_stale', 'severity', 'critical', 'fingerprint', 'monitor_stale:' || r."check",
        'title', case when r."check" = 'vitals' then 'Android vitals checks have stopped'
                      else 'Google Play checks have stopped' end,
        'detail', 'The last successful check was '
                  || coalesce(to_char(r.last_ok_at at time zone 'Asia/Karachi', 'YYYY-MM-DD HH24:MI') || ' (PKT)', 'never')
                  || coalesce('. Last error: ' || r.last_error, '.')
                  || ' Until it runs again, new warnings for this app are not detected.',
        'action_url', '/admin/google-play'));
    else
      v_items := '[]'::jsonb;
    end if;
    perform public.app_warnings_sync(r.project_id, 'monitor_stale_' || r."check", v_items);
  end loop;
  select count(*) into v_due from public.app_monitor_checks
   where next_due_at <= now() and claimed_at is null;
  select count(distinct package) into v_unadopted from public.play_key_apps b
   where not exists (select 1 from public.projects p where p.android_package = b.package)
     and not exists (select 1 from public.play_apps_ignored i where i.package = b.package)
     and (b.adopt_tried_at is null or b.adopt_tried_at < now() - interval '1 hour');
  select count(*) into v_keys from public.play_keys
   where apps_checked_at is null or apps_checked_at < now() - interval '1 day';
  for i in 1 .. least(v_due + v_unadopted + least(v_keys, 1), 8) loop
    perform public.app_monitor_kick();
  end loop;
end;
$$;

-- what "Checks have stopped after (minutes)" means on Admin -> Google Play
comment on column public.app_monitor_config.stale_minutes is
  'Minutes past a check''s own interval (play_minutes / vitals_minutes) without a success before "checks have stopped" is raised.';
