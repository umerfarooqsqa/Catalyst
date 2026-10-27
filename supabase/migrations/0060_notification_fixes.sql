-- =====================================================================
-- 0060: fixes from the 2026-10-27 test run ("why don't notifications arrive when my PC is off").
-- The cloud jobs ran all night; what failed was delivery and the monitor's own reporting.
-- Decided with the user (2026-10-27): fix everything found; bug assignments and comments are
-- emailed at once, other bug changes batch with a 30-minute fallback (was 4 hours).
--
-- Notifications
--   1. Tasks are emailed too (assignment, approval requests, status changes): only bug
--      notifications were, so a task waiting for approval reached nobody with the portal closed.
--   2. Bug assignments and comments are instant (auto-batch projects); the batch fallback is
--      minutes now (project_email_settings.fallback_minutes, default 30).
--   3. App-warning emails are grouped: warnings found within a minute of each other for one
--      person go out as one email (a check run that finds 20 problems sent 20 emails before).
--   4. A failing email insert for one person no longer drops everyone's bell (per-person blocks).
--   5. A Play Console email that names no app now rings the App health members (bell + email)
--      instead of waiting silently on the admin page (play_mail_unmatched_notify).
-- App monitor
--   6. A card a person closed while its problem is still true stays closed (acknowledged): it
--      reopens only after the problem cleared and came back. Before, it reopened and emailed at
--      every check (hourly). An amber->red change re-notifies at most once a day.
--   7. Amber warnings close themselves when they're no longer true (they only listed up).
--   8. "Checks have stopped" (monitor_stale_*) rings App health: before, a dead monitor told nobody.
--   9. A run that died (timeout / request limit) counts as a failed attempt with back-off; a
--      re-check requested during a run (version changed) is no longer overwritten by monitor_done.
--  10. The Worker ping waits 120 s (was 30 s): Cloudflare cancels a run when its caller hangs up.
--  11. An app whose project was deleted or unlinked isn't adopted again (play_apps_ignored).
--  12. play_versions is readable by App health members (like app_warnings / play_builds).
-- =====================================================================

-- ── 6 + 7: acknowledged cards, amber cards close themselves, throttled "worse" ─────────────
alter table public.app_warnings add column if not exists notified_at timestamptz;

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
      -- closed while still true = acknowledged: stays closed. Closed and since cleared = it came back.
      update public.app_warnings
         set source = p_source, kind = it ->> 'kind', severity = it ->> 'severity', title = it ->> 'title',
             detail = it ->> 'detail', action_url = it ->> 'action_url', data = coalesce(it -> 'data', '{}'::jsonb),
             active = true, cleared_at = null, last_seen_at = now(),
             status = case when w.status = 'closed' and w.active then 'closed' else 'open' end,
             reopened_count = reopened_count + case when w.status = 'closed' and not w.active then 1 else 0 end
       where id = w.id;
      if w.status = 'closed' and not w.active then
        v_reopened := v_reopened + 1;
        perform public.app_warning_notify(w.id, 'reopened');
      elsif w.status = 'open' and w.severity = 'warning' and it ->> 'severity' = 'critical'
            and (w.notified_at is null or w.notified_at < now() - interval '1 day') then
        perform public.app_warning_notify(w.id, 'worse');
      end if;
    end if;
  end loop;
  if p_clear then
    update public.app_warnings
       set active = false, cleared_at = now(),
           -- monitor cards and amber warnings close themselves; red app cards wait for a person
           status = case when p_source like 'monitor%' or severity = 'warning' then 'closed' else status end,
           closed_at = case when (p_source like 'monitor%' or severity = 'warning') and status = 'open' then now() else closed_at end,
           close_note = case when (p_source like 'monitor%' or severity = 'warning') and status = 'open'
                             then case when p_source like 'monitor%' then 'Closed by itself: the check works again.'
                                       else 'Closed by itself: no longer true.' end
                             else close_note end
     where project_id = p_project and source = p_source and active
       and not (fingerprint = any (v_seen));
  end if;
  return jsonb_build_object('new', v_new, 'reopened', v_reopened, 'seen', coalesce(array_length(v_seen, 1), 0));
end;
$$;

-- amber warnings that already cleared: close them now (same rule)
update public.app_warnings
   set status = 'closed', closed_at = now(), close_note = 'Closed by itself: no longer true.'
 where status = 'open' and not active and severity = 'warning';

-- ── 3 + 4 + 8: who is told, per person, grouped emails ───────────────────────────────────
create or replace function public.app_warning_email(p_user uuid, p_item jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_email text;
  v_row uuid;
begin
  select ne.email into v_email from public.notification_emails ne where ne.user_id = p_user;
  if v_email is null or exists (select 1 from public.email_opt_outs o
                                 where o.user_id = p_user and o.event_type in ('all', 'app_warning')) then
    return;
  end if;
  -- join an app-warning email for this person that hasn't gone out yet (found in the same minute)
  select id into v_row from public.email_outbox
   where recipient_email = v_email and kind = 'critical' and status = 'queued'
     and send_after > public.email_now() and items -> 0 ->> 'event' = 'app_warning'
   order by created_at desc limit 1
   for update skip locked;
  if found then
    update public.email_outbox set items = items || jsonb_build_array(p_item) where id = v_row;
  else
    insert into public.email_outbox (recipient_id, recipient_email, kind, priority, items, send_after)
    values (p_user, v_email, 'critical', 0, jsonb_build_array(p_item), public.email_now() + interval '1 minute');
  end if;
end;
$$;
revoke all on function public.app_warning_email(uuid, jsonb) from public, anon, authenticated;

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
  -- serious app problems, and the monitor having stopped; amber and other monitor notes are admin-page only
  if w.severity <> 'critical' or (w.source like 'monitor%' and w.source not like 'monitor_stale%') then
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

-- my-queue shows stale-monitor cards too (they now notify); the page filter is in the app

-- ── 5: Play Console emails that name no app ──────────────────────────────────────────────
create or replace function public.play_mail_unmatched_notify(p_subject text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_item jsonb;
  r record;
begin
  v_item := jsonb_build_object(
    'id', gen_random_uuid(), 'ref', 'PLAY', 'title', coalesce(nullif(trim(p_subject), ''), 'Google Play Console message'),
    'project', 'Google Play (no app named)', 'project_id', '', 'severity', 'critical', 'status', 'open',
    'event', 'app_warning',
    'link', rtrim(public.email_config('email_app_url', 'https://catalyst.umerfarooqsqa.workers.dev'), '/')
            || '/admin/google-play#mails');
  for r in select pr.id as user_id from public.profiles pr where 'app_health' = any (pr.skills) loop
    begin
      insert into public.notifications (user_id, type, message)
      values (r.user_id, 'app_warning', 'Play Console email, no app matched: ' || coalesce(p_subject, ''));
      perform public.app_warning_email(r.user_id, v_item);
    exception when others then
      raise warning 'play_mail_unmatched_notify failed for user %: %', r.user_id, sqlerrm;
    end;
  end loop;
end;
$$;
revoke all on function public.play_mail_unmatched_notify(text) from public, anon, authenticated;
grant execute on function public.play_mail_unmatched_notify(text) to service_role;

-- ── 9: dead runs count as failures; re-check requests survive a run ──────────────────────
create or replace function public.monitor_claim(p_limit integer default 1)
returns table (project_id uuid, "check" text, project_name text, package text, current_version text,
               house_slug text, last_ok_at timestamptz)
language plpgsql security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  cfg public.app_monitor_config;
begin
  select * into cfg from public.app_monitor_config;
  if not cfg.enabled then
    return;
  end if;
  -- a claim older than 10 minutes is a run that died (timeout, request limit): a failed attempt
  update public.app_monitor_checks c
     set claimed_at = null, last_run_at = c.claimed_at, attempts = c.attempts + 1,
         last_error = 'The previous check didn''t finish (it ran too long or hit Cloudflare''s request limit).',
         next_due_at = now() + least(
           make_interval(mins => case when c."check" = 'vitals' then cfg.vitals_minutes else cfg.play_minutes end),
           make_interval(mins => (15 * power(2, least(c.attempts, 4)))::int))
   where c.claimed_at < now() - interval '10 minutes';
  return query
  with due as (
    select c.project_id, c."check"
      from public.app_monitor_checks c
     where c.next_due_at <= now() and c.claimed_at is null
     order by c.next_due_at
     limit p_limit
     for update skip locked
  ), upd as (
    update public.app_monitor_checks c set claimed_at = now()
      from due where c.project_id = due.project_id and c."check" = due."check"
    returning c.project_id, c."check", c.last_ok_at
  )
  select u.project_id, u."check", p.name, p.android_package, p.current_version, p.house_slug, u.last_ok_at
    from upd u join public.projects p on p.id = u.project_id;
end;
$$;

create or replace function public.monitor_done(p_project uuid, p_check text, p_ok boolean, p_error text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  cfg public.app_monitor_config;
  v_every interval;
begin
  select * into cfg from public.app_monitor_config;
  v_every := make_interval(mins => case when p_check = 'vitals' then cfg.vitals_minutes else cfg.play_minutes end);
  update public.app_monitor_checks c
     set claimed_at = null, last_run_at = now(), last_error = p_error,
         last_ok_at = case when p_ok then now() else c.last_ok_at end,
         attempts = case when p_ok then 0 else c.attempts + 1 end,
         -- monitor_request during the run (version / target SDK changed) moved next_due_at past the claim: keep it
         next_due_at = case when c.claimed_at is not null and c.next_due_at > c.claimed_at then c.next_due_at
                            else now() + case when p_ok then v_every
                                              else least(v_every, make_interval(mins => (15 * power(2, least(c.attempts, 4)))::int)) end
                       end
   where c.project_id = p_project and c."check" = p_check;
end;
$$;

-- ── 10: wait for the Worker ───────────────────────────────────────────────────────────────
create or replace function public.app_monitor_kick()
returns void
language plpgsql security definer
set search_path = public, net
as $$
declare
  v_url text := public.monitor_setting('monitor_url');
  v_secret text := public.monitor_setting('monitor_secret');
begin
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-monitor-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
exception when others then
  raise warning 'app_monitor_kick failed: %', sqlerrm;
end;
$$;

-- ── 11: apps people dropped stay dropped ─────────────────────────────────────────────────
create table if not exists public.play_apps_ignored (
  package     text primary key,
  ignored_at  timestamptz not null default now(),
  note        text
);
alter table public.play_apps_ignored enable row level security;
drop policy if exists play_apps_ignored_select on public.play_apps_ignored;
create policy play_apps_ignored_select on public.play_apps_ignored
  for select to authenticated using (public.is_admin() or public.in_app_health());

create or replace function public.projects_play_ignore()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.android_package is not null
       and exists (select 1 from public.play_key_apps where package = old.android_package) then
      insert into public.play_apps_ignored (package, note)
      values (old.android_package, 'Its project "' || old.name || '" was deleted.')
      on conflict (package) do nothing;
    end if;
    return old;
  end if;
  if old.android_package is not null and new.android_package is distinct from old.android_package
     and exists (select 1 from public.play_key_apps where package = old.android_package)
     and not exists (select 1 from public.projects where android_package = old.android_package and id <> new.id) then
    insert into public.play_apps_ignored (package, note)
    values (old.android_package, 'Unlinked from project "' || new.name || '".')
    on conflict (package) do nothing;
  end if;
  if new.android_package is not null then
    delete from public.play_apps_ignored where package = new.android_package;  -- linked again
  end if;
  return new;
end;
$$;
drop trigger if exists trg_projects_play_ignore on public.projects;
create trigger trg_projects_play_ignore
  after update of android_package or delete on public.projects
  for each row execute function public.projects_play_ignore();
drop trigger if exists trg_projects_play_ignore_insert on public.projects;
create trigger trg_projects_play_ignore_insert
  after insert on public.projects
  for each row when (new.android_package is not null) execute function public.projects_play_ignore();

create or replace function public.play_app_claim()
returns table (package text, key_id uuid)
language plpgsql security definer
set search_path = public
as $$
begin
  return query
  update public.play_key_apps a
     set adopt_tried_at = now()
   where (a.key_id, a.package) = (
     select b.key_id, b.package from public.play_key_apps b
      where not exists (select 1 from public.projects p where p.android_package = b.package)
        and not exists (select 1 from public.play_apps_ignored i where i.package = b.package)
        and (b.adopt_tried_at is null or b.adopt_tried_at < now() - interval '1 hour')
      order by b.adopt_tried_at nulls first, b.package
      limit 1
      for update skip locked)
  returning a.package, a.key_id;
end;
$$;
revoke all on function public.play_app_claim() from public, anon, authenticated;
grant execute on function public.play_app_claim() to service_role;

-- the sweep's count of waiting apps follows the same rule, and a key due for re-listing starts a run
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
revoke all on function public.app_monitor_sweep() from public, anon, authenticated;

-- ── 12 ───────────────────────────────────────────────────────────────────────────────────
drop policy if exists play_versions_select on public.play_versions;
create policy play_versions_select on public.play_versions
  for select to authenticated
  using ((not public.is_contributor() or public.in_app_health()) and public.can_see_project(project_id));

-- ── 1 + 2: emails for tasks; assignments and comments at once; fallback in minutes ───────
alter table public.project_email_settings add column if not exists fallback_minutes integer not null default 30;
alter table public.project_email_settings drop constraint if exists project_email_settings_fallback_minutes_check;
alter table public.project_email_settings add constraint project_email_settings_fallback_minutes_check
  check (fallback_minutes between 5 and 4320);
update public.project_email_settings set fallback_minutes = 30;

create or replace function public.email_maybe_flush(p_email text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_now        timestamptz := public.email_now();
  v_auto       integer;
  v_n          integer;
  v_old        boolean;
  v_digest_due boolean;
  v_instant    boolean;
begin
  if not pg_try_advisory_xact_lock(hashtext('catalyst-email:' || p_email)) then
    return null;
  end if;
  if public.email_quota_full() then
    return null;
  end if;
  select count(*) filter (where coalesce(s.mode, 'auto_batch') = 'auto_batch'),
         min(coalesce(s.batch_size, 5)) filter (where coalesce(s.mode, 'auto_batch') = 'auto_batch'),
         coalesce(bool_or(coalesce(s.mode, 'auto_batch') = 'auto_batch'
                          and pe.created_at <= v_now - make_interval(mins => coalesce(s.fallback_minutes, 30))), false),
         coalesce(bool_or(s.mode = 'daily_digest'
                          and pe.created_at < public.email_last_digest(s.digest_time)), false),
         coalesce(bool_or(s.mode = 'instant'), false)
    into v_auto, v_n, v_old, v_digest_due, v_instant
  from public.email_pending pe
  left join public.project_email_settings s on s.project_id = pe.project_id
  where pe.recipient_email = p_email;

  if (v_n is not null and v_auto >= v_n) or v_old or v_digest_due or v_instant then
    return public.email_flush(p_email);
  end if;
  return null;
end;
$$;

create or replace function public.email_enqueue(p_user uuid, p_bug uuid, p_event text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_email    text;
  v_project  uuid;
  v_severity public.bug_severity;
  v_mode     text;
  v_critical boolean;
begin
  select email into v_email from public.notification_emails where user_id = p_user;
  if v_email is null then
    return;
  end if;
  if exists (select 1 from public.email_opt_outs
             where user_id = p_user and event_type in ('all', p_event)) then
    return;
  end if;
  select project_id, severity into v_project, v_severity from public.bugs where id = p_bug;
  if v_project is null then
    return;
  end if;
  v_mode := coalesce((select mode from public.project_email_settings where project_id = v_project), 'auto_batch');
  v_critical := v_severity = 'critical';

  -- critical bugs, instant projects, and (decided 2026-10-27) assignments and comments outside a digest
  if v_critical or v_mode = 'instant' or (v_mode = 'auto_batch' and p_event in ('assignment', 'comment')) then
    delete from public.email_pending where recipient_email = v_email and bug_id = p_bug;
    insert into public.email_outbox (recipient_id, recipient_email, kind, priority, items)
    values (p_user, v_email,
            case when v_critical then 'critical' else 'instant' end,
            case when v_critical then 0 else 5 end,
            jsonb_build_array(public.email_bug_item(p_bug, p_event)));
    return;
  end if;

  insert into public.email_pending (recipient_id, recipient_email, project_id, bug_id, event_type)
  values (p_user, v_email, v_project, p_bug, p_event)
  on conflict (recipient_email, bug_id) do update
    set event_type = excluded.event_type,
        project_id = excluded.project_id,
        updated_at = public.email_now();
  if v_mode = 'auto_batch' then
    perform public.email_maybe_flush(v_email);
  end if;
end;
$$;

create or replace function public.email_task_item(p_task uuid, p_event text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', t.id,
    'ref', left(t.id::text, 8),
    'title', t.title,
    'project', p.name,
    'project_id', p.id,
    'severity', coalesce(t.priority::text, 'medium'),
    'status', t.status,
    'event', p_event,
    'item', 'task',
    'link', rtrim(public.email_config('email_app_url', 'https://catalyst.umerfarooqsqa.workers.dev'), '/')
              || '/projects/' || t.project_id || '/tasks?focus=' || t.id
  )
  from public.tasks t
  join public.projects p on p.id = t.project_id
  where t.id = p_task
$$;

create or replace function public.notifications_email()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if new.related_bug_id is not null
     and new.type::text in ('assignment', 'status_change', 'comment', 'retest_ready') then
    perform public.email_enqueue(new.user_id, new.related_bug_id, new.type::text);
  elsif new.related_task_id is not null
     and new.type::text in ('assignment', 'status_change', 'comment') then
    -- tasks are few and often need an answer (approval): one email each, at once
    select email into v_email from public.notification_emails where user_id = new.user_id;
    if v_email is not null and not exists (select 1 from public.email_opt_outs
                                           where user_id = new.user_id and event_type in ('all', new.type::text)) then
      insert into public.email_outbox (recipient_id, recipient_email, kind, priority, items)
      select new.user_id, v_email, 'instant', 5, jsonb_build_array(item)
        from (select public.email_task_item(new.related_task_id, new.type::text) as item) x
       where item is not null;
    end if;
  end if;
  return new;
exception when others then
  raise warning 'email for notification % failed: %', new.id, sqlerrm;
  return new;
end;
$$;
