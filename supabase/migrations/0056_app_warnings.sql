-- =====================================================================
-- 0056: app warnings, checked in the cloud, shown as red cards.
--
-- Decided with the user (2026-10-26): every warning about an Android app becomes a card in
-- My Queue for admins and QA, and nothing depends on a tester's PC.
--   * A pg_cron job (catalyst-app-monitor, every 5 min) pings POST /api/monitor/run
--     (pg_net, header x-monitor-secret from private.settings). The route claims the
--     checks that are due (monitor_claim), reads Google Play with the service-account keys
--     kept in Supabase Vault (play_keys), and writes what it finds with app_warnings_sync.
--   * Checks: Play releases + target API + portal ('play', hourly) and Android vitals
--     ('vitals', every 6 h). A version, package or target-SDK change re-runs 'play' at once
--     (monitor_request triggers). The sweep itself raises "app checks have stopped" when a
--     project's checks haven't succeeded for stale_minutes, so a dead Worker is visible.
--   * Play Console emails (policy, Inbox, removal notices) arrive from a Google Apps Script
--     at POST /api/intake/play-mail (key play_mail_key) and become cards too (play_emails).
--   * A card stays until QA/an admin closes it (app_warning_close). If its condition is still
--     true at a later check it reopens; if the condition clears it stays open, marked cleared.
--   * New and reopened warnings ring the bell for admins and QA who can see the project;
--     critical ones are also emailed (email_outbox, kind critical).
--   * Monitoring starts switched off (app_monitor_config.enabled): an admin turns it on on
--     Admin -> Google Play once the keys are uploaded, so setup doesn't page everyone.
-- Visibility: warnings follow the automation tables (not developers, can_see_project); keys,
-- config and Play emails are admin-only. All writes from the job go through the service role.
-- =====================================================================

-- 1. What the checks need on projects and versions --------------------------------------
alter table public.projects add column if not exists android_package text;
create unique index if not exists projects_android_package_key on public.projects (android_package)
  where android_package is not null;
alter table public.projects drop constraint if exists projects_android_package_format;
alter table public.projects add constraint projects_android_package_format
  check (android_package is null or android_package ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$');

-- Every mapped Android house's package is com.catalyst.<house_slug> (checked against
-- aktrade config/config.py APPS on 2026-10-26).
update public.projects
   set android_package = 'com.catalyst.' || house_slug
 where house_slug is not null and platform = 'android' and android_package is null;

alter table public.releases add column if not exists target_sdk integer;
alter table public.releases drop constraint if exists releases_target_sdk_range;
alter table public.releases add constraint releases_target_sdk_range
  check (target_sdk is null or target_sdk between 1 and 99);

-- 2. Settings ------------------------------------------------------------------------------
create table if not exists public.app_monitor_config (
  id                   boolean primary key default true check (id),
  enabled              boolean not null default false,
  early_share          numeric not null default 0.75 check (early_share > 0 and early_share < 1),
  crash_limit          numeric not null default 0.0109,   -- user-perceived crash rate, overall
  anr_limit            numeric not null default 0.0047,   -- user-perceived ANR rate, overall
  device_limit         numeric not null default 0.08,     -- either rate on one phone model
  wakelock_limit       numeric not null default 0.05,     -- stuck background wake locks
  device_min_users     integer not null default 100,
  new_crash_min_users  integer not null default 20,
  play_minutes         integer not null default 60,
  vitals_minutes       integer not null default 360,
  stale_minutes        integer not null default 180,
  target_warn_days     integer not null default 90,
  updated_at           timestamptz not null default now()
);
insert into public.app_monitor_config (id) values (true) on conflict (id) do nothing;

-- Google's target API level requirements for phone apps (support.google.com/googleplay/
-- android-developer/answer/11926878). An admin adds the next row when Google announces it.
create table if not exists public.target_api_rules (
  id              uuid primary key default gen_random_uuid(),
  applies_to      text not null check (applies_to in ('updates', 'existing')),
  min_api         integer not null check (min_api between 1 and 99),
  effective_date  date not null,
  note            text,
  unique (applies_to, effective_date)
);
insert into public.target_api_rules (applies_to, min_api, effective_date, note) values
  ('updates',  35, '2025-08-31', 'New apps and app updates must target Android 15 (API 35) or higher.'),
  ('existing', 34, '2025-08-31', 'Existing apps must target Android 14 (API 34) or higher to stay available to new users on devices running newer Android.'),
  ('updates',  36, '2026-08-31', 'New apps and app updates must target Android 16 (API 36) or higher.'),
  ('existing', 35, '2026-08-31', 'Existing apps must target Android 15 (API 35) or higher to stay available to new users on devices running newer Android.')
on conflict (applies_to, effective_date) do nothing;

-- private.settings (0016/0044): where the cron pings, and the keys the routes check.
create schema if not exists private;
create table if not exists private.settings (key text primary key, value text);
insert into private.settings (key, value) values
  ('monitor_url', 'https://catalyst.umerfarooqsqa.workers.dev/api/monitor/run'),
  ('monitor_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')),
  ('play_mail_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

create or replace function public.monitor_setting(p_key text)
returns text
language sql stable security definer
set search_path = public, private
as $$ select nullif(value, '') from private.settings where key = p_key $$;

-- 3. Google service-account keys, encrypted in Vault --------------------------------------
create table if not exists public.play_keys (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  client_email     text not null unique,
  gcp_project      text,
  vault_secret_id  uuid not null,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  apps_checked_at  timestamptz,           -- when the job last listed the apps this key reaches
  last_ok_at       timestamptz,
  last_error       text
);
create table if not exists public.play_key_apps (
  key_id   uuid not null references public.play_keys(id) on delete cascade,
  package  text not null,
  seen_at  timestamptz not null default now(),
  primary key (key_id, package)
);

-- Upload or replace a key (Admin -> Google Play). The JSON goes straight into Vault; the
-- table keeps only what is safe to show.
create or replace function public.play_key_put(p_name text, p_key jsonb)
returns uuid
language plpgsql security definer
set search_path = public, vault
as $$
declare
  v_email  text := p_key ->> 'client_email';
  v_row    public.play_keys;
  v_secret uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can add Google Play keys';
  end if;
  if coalesce(p_key ->> 'type', '') <> 'service_account' or v_email is null
     or coalesce(p_key ->> 'private_key', '') not like '-----BEGIN PRIVATE KEY-----%' then
    raise exception 'This is not a Google service-account key (JSON with type service_account, client_email and private_key)';
  end if;
  select * into v_row from public.play_keys where client_email = v_email;
  if found then
    perform vault.update_secret(v_row.vault_secret_id, p_key::text);
    update public.play_keys
       set name = coalesce(nullif(trim(p_name), ''), name), gcp_project = p_key ->> 'project_id',
           apps_checked_at = null, last_error = null
     where id = v_row.id;
    return v_row.id;
  end if;
  v_secret := vault.create_secret(p_key::text, 'play_key_' || replace(v_email, '@', '_at_'),
                                  'Google Play service-account key (catalyst app monitor)');
  insert into public.play_keys (name, client_email, gcp_project, vault_secret_id, created_by)
  values (coalesce(nullif(trim(p_name), ''), split_part(v_email, '@', 1)), v_email,
          p_key ->> 'project_id', v_secret, auth.uid())
  returning id into v_row.id;
  return v_row.id;
end;
$$;

create or replace function public.play_key_delete(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, vault
as $$
declare v_secret uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can remove Google Play keys';
  end if;
  delete from public.play_keys where id = p_id returning vault_secret_id into v_secret;
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
end;
$$;

-- The key JSON, for the monitor job only (service role).
create or replace function public.play_key_secret(p_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, vault
as $$
  select ds.decrypted_secret::jsonb
    from public.play_keys k join vault.decrypted_secrets ds on ds.id = k.vault_secret_id
   where k.id = p_id
$$;

-- 4. Warnings ------------------------------------------------------------------------------
create table if not exists public.app_warnings (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  source          text not null,      -- releases | vitals | target_api | portal | monitor_* | play_email
  kind            text not null,
  severity        text not null check (severity in ('critical', 'warning')),
  fingerprint     text not null,
  title           text not null,
  detail          text,
  action_url      text,
  data            jsonb not null default '{}'::jsonb,
  active          boolean not null default true,
  status          text not null default 'open' check (status in ('open', 'closed')),
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  cleared_at      timestamptz,
  closed_by       uuid references public.profiles(id) on delete set null,
  closed_at       timestamptz,
  close_note      text,
  reopened_count  integer not null default 0,
  updated_at      timestamptz not null default now(),
  unique (project_id, fingerprint)
);
create index if not exists app_warnings_open_idx on public.app_warnings (status, severity, last_seen_at desc);
drop trigger if exists trg_app_warnings_updated on public.app_warnings;
create trigger trg_app_warnings_updated before update on public.app_warnings
  for each row execute procedure public.touch_updated_at();

alter type public.notification_type add value if not exists 'app_warning';
alter table public.notifications add column if not exists related_warning_id uuid
  references public.app_warnings(id) on delete set null;

-- Bell for admins and QA who can see the project; critical ones also by email.
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
    if w.severity = 'critical' then
      insert into public.email_outbox (recipient_id, recipient_email, kind, priority, items)
      select r.user_id, ne.email, 'critical', 0, jsonb_build_array(v_item)
        from public.notification_emails ne
       where ne.user_id = r.user_id
         and not exists (select 1 from public.email_opt_outs o
                          where o.user_id = r.user_id and o.event_type in ('all', 'app_warning'));
    end if;
  end loop;
exception when others then
  raise warning 'app_warning_notify failed for %: %', p_id, sqlerrm;  -- never block the check
end;
$$;

-- The monitor's write: this source's current findings for one project.
--   new -> inserted + notified; still true -> refreshed (reopened + notified if it was closed,
--   notified if it got worse); gone -> active = false (cleared), left open for a person.
-- p_clear = false for sources that report events, not conditions (Play emails).
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
       set active = false, cleared_at = now()
     where project_id = p_project and source = p_source and active
       and not (fingerprint = any (v_seen));
  end if;
  return jsonb_build_object('new', v_new, 'reopened', v_reopened, 'seen', coalesce(array_length(v_seen, 1), 0));
end;
$$;

-- QA/admin closes a card (it comes back if the condition is still true at the next check).
create or replace function public.app_warning_close(p_id uuid, p_note text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_project uuid;
begin
  select project_id into v_project from public.app_warnings where id = p_id;
  if v_project is null then
    raise exception 'No such warning';
  end if;
  if not (public.is_qa_or_admin() and public.can_see_project(v_project)) then
    raise exception 'Only QA or an admin can close app warnings';
  end if;
  update public.app_warnings
     set status = 'closed', closed_by = auth.uid(), closed_at = now(), close_note = nullif(trim(p_note), '')
   where id = p_id and status = 'open';
end;
$$;

-- 5. Play Console emails (Google Apps Script intake) ---------------------------------------
create table if not exists public.play_emails (
  id           uuid primary key default gen_random_uuid(),
  message_id   text not null unique,
  thread_id    text,
  received_at  timestamptz,
  sender       text,
  subject      text,
  excerpt      text,
  project_id   uuid references public.projects(id) on delete set null,
  warning_id   uuid references public.app_warnings(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- 6. The work queue --------------------------------------------------------------------------
create table if not exists public.app_monitor_checks (
  project_id   uuid not null references public.projects(id) on delete cascade,
  "check"      text not null check ("check" in ('play', 'vitals')),
  next_due_at  timestamptz not null default now(),
  claimed_at   timestamptz,
  last_run_at  timestamptz,
  last_ok_at   timestamptz,
  last_error   text,
  attempts     integer not null default 0,
  created_at   timestamptz not null default now(),
  primary key (project_id, "check")
);

-- A project is monitored while it is an Android project with a package.
create or replace function public.app_monitor_sync_project(p_project uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.projects where id = p_project and platform = 'android' and android_package is not null) then
    insert into public.app_monitor_checks (project_id, "check")
    values (p_project, 'play'), (p_project, 'vitals')
    on conflict (project_id, "check") do nothing;
  else
    delete from public.app_monitor_checks where project_id = p_project;
  end if;
end;
$$;
select public.app_monitor_sync_project(id) from public.projects;

-- Ping the Worker (no-op when the URL or secret is unset). Never raises.
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
    timeout_milliseconds := 30000);
exception when others then
  raise warning 'app_monitor_kick failed: %', sqlerrm;
end;
$$;

-- Re-check one project's Play/target/portal state now (a version or package changed).
create or replace function public.monitor_request(p_project uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.app_monitor_checks set next_due_at = now(), attempts = 0
   where project_id = p_project and "check" = 'play';
  if found and (select enabled from public.app_monitor_config) then
    perform public.app_monitor_kick();
  end if;
end;
$$;

create or replace function public.projects_monitor_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.app_monitor_sync_project(new.id);
  if tg_op = 'INSERT'
     or new.current_version is distinct from old.current_version
     or new.android_package is distinct from old.android_package
     or new.platform is distinct from old.platform then
    perform public.monitor_request(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_projects_monitor on public.projects;
create trigger trg_projects_monitor
  after insert or update of current_version, android_package, platform on public.projects
  for each row execute function public.projects_monitor_change();

create or replace function public.releases_monitor_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.target_sdk is distinct from old.target_sdk
     or new.release_notes_ref is distinct from old.release_notes_ref then
    perform public.monitor_request(new.project_id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_releases_monitor on public.releases;
create trigger trg_releases_monitor
  after insert or update of target_sdk, release_notes_ref on public.releases
  for each row execute function public.releases_monitor_change();

-- The Worker takes due checks; a claim older than 10 minutes is taken back (crashed run).
create or replace function public.monitor_claim(p_limit integer default 1)
returns table (project_id uuid, "check" text, project_name text, package text, current_version text,
               house_slug text, last_ok_at timestamptz)
language plpgsql security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not (select enabled from public.app_monitor_config) then
    return;
  end if;
  return query
  with due as (
    select c.project_id, c."check"
      from public.app_monitor_checks c
     where c.next_due_at <= now()
       and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
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

-- The Worker reports a finished check. Failures retry in 15 minutes (doubling, at most the interval).
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
         next_due_at = now() + case when p_ok then v_every
                                    else least(v_every, make_interval(mins => (15 * power(2, least(c.attempts, 4)))::int)) end
   where c.project_id = p_project and c."check" = p_check;
end;
$$;

-- Every 5 minutes: raise/clear "app checks have stopped" (works even when the Worker is
-- down), then ping the Worker if anything is due.
create or replace function public.app_monitor_sweep()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  cfg public.app_monitor_config;
  r record;
  v_items jsonb;
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
  if exists (select 1 from public.app_monitor_checks where next_due_at <= now()) then
    perform public.app_monitor_kick();
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'catalyst-app-monitor') then
      perform cron.unschedule('catalyst-app-monitor');
    end if;
    perform cron.schedule('catalyst-app-monitor', '*/5 * * * *', 'select public.app_monitor_sweep()');
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;

-- Admin -> Google Play: the Apps Script settings (admin only).
create or replace function public.play_mail_setup()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  return jsonb_build_object('key', public.monitor_setting('play_mail_key'),
                            'monitor_url', public.monitor_setting('monitor_url'));
end;
$$;

-- 7. Visibility ---------------------------------------------------------------------------------
alter table public.app_warnings enable row level security;
drop policy if exists app_warnings_select on public.app_warnings;
create policy app_warnings_select on public.app_warnings
  for select to authenticated
  using (not public.is_contributor() and public.can_see_project(project_id));

alter table public.app_monitor_checks enable row level security;
drop policy if exists app_monitor_checks_select on public.app_monitor_checks;
create policy app_monitor_checks_select on public.app_monitor_checks
  for select to authenticated using (public.is_qa_or_admin());

alter table public.app_monitor_config enable row level security;
drop policy if exists app_monitor_config_select on public.app_monitor_config;
create policy app_monitor_config_select on public.app_monitor_config
  for select to authenticated using (public.is_qa_or_admin());
drop policy if exists app_monitor_config_admin on public.app_monitor_config;
create policy app_monitor_config_admin on public.app_monitor_config
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.target_api_rules enable row level security;
drop policy if exists target_api_rules_select on public.target_api_rules;
create policy target_api_rules_select on public.target_api_rules
  for select to authenticated using (true);
drop policy if exists target_api_rules_admin on public.target_api_rules;
create policy target_api_rules_admin on public.target_api_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.play_keys enable row level security;
drop policy if exists play_keys_admin_select on public.play_keys;
create policy play_keys_admin_select on public.play_keys
  for select to authenticated using (public.is_admin());

alter table public.play_key_apps enable row level security;
drop policy if exists play_key_apps_admin_select on public.play_key_apps;
create policy play_key_apps_admin_select on public.play_key_apps
  for select to authenticated using (public.is_admin());

alter table public.play_emails enable row level security;
drop policy if exists play_emails_admin_select on public.play_emails;
create policy play_emails_admin_select on public.play_emails
  for select to authenticated using (public.is_admin());

-- Functions: people call close / put / delete / setup (each checks the role itself); the job's
-- functions are service role only.
revoke all on function public.play_key_put(text, jsonb) from public, anon;
revoke all on function public.play_key_delete(uuid) from public, anon;
revoke all on function public.app_warning_close(uuid, text) from public, anon;
revoke all on function public.play_mail_setup() from public, anon;
grant execute on function public.play_key_put(text, jsonb) to authenticated;
grant execute on function public.play_key_delete(uuid) to authenticated;
grant execute on function public.app_warning_close(uuid, text) to authenticated;
grant execute on function public.play_mail_setup() to authenticated;

revoke all on function public.monitor_setting(text) from public, anon, authenticated;
revoke all on function public.play_key_secret(uuid) from public, anon, authenticated;
revoke all on function public.app_warning_notify(uuid, text) from public, anon, authenticated;
revoke all on function public.app_warnings_sync(uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.app_monitor_sync_project(uuid) from public, anon, authenticated;
revoke all on function public.app_monitor_kick() from public, anon, authenticated;
revoke all on function public.monitor_request(uuid) from public, anon, authenticated;
revoke all on function public.monitor_claim(integer) from public, anon, authenticated;
revoke all on function public.monitor_done(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function public.app_monitor_sweep() from public, anon, authenticated;
revoke all on function public.projects_monitor_change() from public, anon, authenticated;
revoke all on function public.releases_monitor_change() from public, anon, authenticated;
grant execute on function public.monitor_setting(text) to service_role;
grant execute on function public.play_key_secret(uuid) to service_role;
grant execute on function public.app_warnings_sync(uuid, text, jsonb, boolean) to service_role;
grant execute on function public.monitor_request(uuid) to service_role;
grant execute on function public.monitor_claim(integer) to service_role;
grant execute on function public.monitor_done(uuid, text, boolean, text) to service_role;
grant execute on function public.app_monitor_kick() to service_role;
