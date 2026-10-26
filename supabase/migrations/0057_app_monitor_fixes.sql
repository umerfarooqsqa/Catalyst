-- =====================================================================
-- 0057: fixes from the app monitor's first live run (2026-10-26).
--
-- 1. Cloudflare allows ~50 outgoing requests per Worker invocation (every Supabase and
--    Google call counts). The Worker now runs ONE check per invocation, so the sweep pings
--    it several times in parallel (one per due check, at most 8 per sweep); pg_net sends
--    them concurrently and each is its own invocation with its own budget.
-- 2. Monitor-health cards ("can't be checked", "checks have stopped") are about the monitor,
--    not the app: they ring the bell but are never emailed. (The first run, made before any
--    key was uploaded, emailed every admin and QA for each app.)
-- 3. Monitor-health cards close themselves once the check works again (with a note), so a
--    setup hiccup doesn't leave dozens of cards for people to close by hand. App cards are
--    unchanged: they stay until a person closes them.
-- =====================================================================

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
     where ro.level in ('admin', 'manager')
       and (ro.platform is null or ro.platform = v_project.platform)
  loop
    insert into public.notifications (user_id, type, message, related_warning_id)
    values (r.user_id, 'app_warning',
            v_project.name || ': ' || w.title || case when p_event = 'reopened' then ' (again)' else '' end,
            w.id);
    if w.severity = 'critical' and w.source not like 'monitor%' then
      insert into public.email_outbox (recipient_id, recipient_email, kind, priority, items)
      select r.user_id, ne.email, 'critical', 0, jsonb_build_array(v_item)
        from public.notification_emails ne
       where ne.user_id = r.user_id
         and not exists (select 1 from public.email_opt_outs o
                          where o.user_id = r.user_id and o.event_type in ('all', 'app_warning'));
    end if;
  end loop;
exception when others then
  raise warning 'app_warning_notify failed for %: %', p_id, sqlerrm;
end;
$$;

create or replace function public.app_warnings_sync(p_project uuid, p_source text, p_items jsonb,
                                                    p_clear boolean default true)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  it jsonb;
  w public.app_warnings;
  v_new int := 0; v_reopened int := 0; v_seen text[] := '{}';
begin
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_seen := v_seen || (it ->> 'fingerprint');
    select * into w from public.app_warnings
     where project_id = p_project and fingerprint = it ->> 'fingerprint' for update;
    if not found then
      insert into public.app_warnings (project_id, source, kind, severity, fingerprint, title, detail, action_url, data)
      values (p_project, p_source, it ->> 'kind', it ->> 'severity', it ->> 'fingerprint', it ->> 'title',
              it ->> 'detail', it ->> 'action_url', coalesce(it -> 'data', '{}'::jsonb))
      returning * into w;
      v_new := v_new + 1;
      perform public.app_warning_notify(w.id, 'new');
    else
      update public.app_warnings
         set source = p_source, kind = it ->> 'kind', severity = it ->> 'severity', title = it ->> 'title',
             detail = it ->> 'detail', action_url = it ->> 'action_url', data = coalesce(it -> 'data', '{}'::jsonb),
             active = true, cleared_at = null, last_seen_at = now(),
             status = 'open',
             reopened_count = reopened_count + case when w.status = 'closed' then 1 else 0 end
       where id = w.id;
      if w.status = 'closed' then
        v_reopened := v_reopened + 1;
        perform public.app_warning_notify(w.id, 'reopened');
      elsif w.severity = 'warning' and it ->> 'severity' = 'critical' then
        perform public.app_warning_notify(w.id, 'worse');
      end if;
    end if;
  end loop;
  if p_clear then
    update public.app_warnings
       set active = false, cleared_at = now(),
           -- monitor-health cards close themselves; app cards wait for a person
           status = case when p_source like 'monitor%' then 'closed' else status end,
           closed_at = case when p_source like 'monitor%' and status = 'open' then now() else closed_at end,
           close_note = case when p_source like 'monitor%' and status = 'open'
                             then 'Closed by itself: the check works again.' else close_note end
     where project_id = p_project and source = p_source and active
       and not (fingerprint = any (v_seen));
  end if;
  return jsonb_build_object('new', v_new, 'reopened', v_reopened, 'seen', coalesce(array_length(v_seen, 1), 0));
end;
$$;

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
begin
  select * into cfg from public.app_monitor_config;
  if not cfg.enabled then
    return;
  end if;
  for r in
    select c.project_id, c."check", c.last_ok_at, c.last_error, c.created_at
      from public.app_monitor_checks c
  loop
    if coalesce(r.last_ok_at, r.created_at) < now() - make_interval(mins => cfg.stale_minutes) then
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
  -- one Worker invocation per due check (each has its own request budget), at most 8 at a time
  select count(*) into v_due from public.app_monitor_checks
   where next_due_at <= now() and (claimed_at is null or claimed_at < now() - interval '10 minutes');
  for i in 1 .. least(v_due, 8) loop
    perform public.app_monitor_kick();
  end loop;
end;
$$;

revoke all on function public.app_warning_notify(uuid, text) from public, anon, authenticated;
revoke all on function public.app_warnings_sync(uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.app_monitor_sweep() from public, anon, authenticated;
grant execute on function public.app_warnings_sync(uuid, text, jsonb, boolean) to service_role;
