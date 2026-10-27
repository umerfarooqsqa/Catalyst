-- =====================================================================
-- 0059: each build's real target SDK, read from Google Play, and Google's 2026 extension.
--
-- Asked by the user (2026-10-27): the point of the app monitor is Play Console's "Policy
-- status" page ("App not available to new users on Android versions higher than your target
-- API level", "App updates with these issues will be rejected ... Fix by Nov 1"). Google has no
-- API for that page, but its target-API part follows from the rules once each live build's
-- target SDK is known, and that no longer has to be typed in:
--   * Play serves the APKs it generated from an app bundle (generatedApks, allowed with "View
--     app information"); the Worker reads only the start of the base APK (~10 KB, a Range
--     request) and takes min/target SDK from AndroidManifest.xml (lib/monitor/apk.ts).
--     Checked 2026-10-27 against aapt on JS 1.0.13 (min 26, target 36).
--   * play_builds keeps one row per (package, build), so each build is downloaded once. Apps
--     uploaded as plain APKs (no bundle) have no generated APKs: their row holds the error, and
--     the portal's releases.target_sdk is still the fallback.
--   * target_api_rules.extended_to: Google let apps ask for more time to meet the 2026 rule
--     for updates (API 36), until Nov 1, 2026. Play Console shows it as "Fix by Nov 1".
-- =====================================================================

create table if not exists public.play_builds (
  package       text not null,
  version_code  integer not null,
  version_name  text,
  min_sdk       integer,
  target_sdk    integer,
  error         text,        -- why Play couldn't give it (retried after a day)
  read_at       timestamptz not null default now(),
  primary key (package, version_code)
);

alter table public.play_builds enable row level security;
drop policy if exists play_builds_select on public.play_builds;
create policy play_builds_select on public.play_builds
  for select to authenticated
  using (not public.is_contributor() or public.in_app_health());
-- written only by the monitor (service role)

alter table public.target_api_rules add column if not exists extended_to date;
alter table public.target_api_rules drop constraint if exists target_api_rules_extension_after;
alter table public.target_api_rules add constraint target_api_rules_extension_after
  check (extended_to is null or extended_to > effective_date);

update public.target_api_rules
   set extended_to = '2026-11-01',
       note = 'New apps and app updates must target Android 16 (API 36) or higher. Apps that asked Google for more time have until Nov 1, 2026.'
 where applies_to = 'updates' and min_api = 36 and effective_date = '2026-08-31' and extended_to is null;

-- ---------------------------------------------------------------------
-- Every app the keys reach is watched (decided with the user, 2026-10-27).
-- The Policy status problems were on older apps in the same Play accounts, which had no
-- catalyst project (all 17 projects' live builds target API 36; ten older apps target 33-34).
-- An app with no project gets one: a same-named Android project without an app is linked to it,
-- else a new project named after its Play Store title is created (added_from_play). The Worker
-- reads the title, one app per run (play_app_claim -> play_app_adopt).
-- ---------------------------------------------------------------------

alter table public.projects add column if not exists added_from_play boolean not null default false;
alter table public.play_key_apps add column if not exists adopt_tried_at timestamptz;
alter table public.play_key_apps add column if not exists adopt_error text;

-- The next app that no project has (a failed try waits an hour). Parallel runs take different ones.
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
        and (b.adopt_tried_at is null or b.adopt_tried_at < now() - interval '1 hour')
      order by b.adopt_tried_at nulls first, b.package
      limit 1
      for update skip locked)
  returning a.package, a.key_id;
end;
$$;

-- Gives the app a project; returns its id. Never two projects for one package (unique index).
create or replace function public.play_app_adopt(p_package text, p_title text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_title text := left(coalesce(nullif(trim(p_title), ''), p_package), 120);
  v_desc text := 'Added automatically: this app (' || p_package || ') is in a Google Play developer account '
                 || 'that catalyst watches, so its Play warnings (policy, target API, releases, vitals) show here.';
begin
  select id into v_id from public.projects where android_package = p_package;
  if found then
    return v_id;
  end if;
  -- an Android project with the same name and no app yet is this app
  select id into v_id from public.projects
   where platform = 'android' and android_package is null and name_key = public.project_name_key(v_title)
   order by created_at limit 1;
  if found then
    update public.projects set android_package = p_package where id = v_id;
    return v_id;
  end if;
  begin
    insert into public.projects (name, description, platform, android_package, added_from_play)
    values (v_title, v_desc, 'android', p_package, true)
    returning id into v_id;
  exception when unique_violation then
    -- the name is taken (by a project with another app) or a parallel run just added the package
    select id into v_id from public.projects where android_package = p_package;
    if v_id is null then
      insert into public.projects (name, description, platform, android_package, added_from_play)
      values (v_title || ' (' || p_package || ')', v_desc, 'android', p_package, true)
      returning id into v_id;
    end if;
  end;
  return v_id;
end;
$$;

revoke all on function public.play_app_claim() from public, anon, authenticated;
revoke all on function public.play_app_adopt(text, text) from public, anon, authenticated;
grant execute on function public.play_app_claim() to service_role;
grant execute on function public.play_app_adopt(text, text) to service_role;

-- The sweep (0057) also starts a run while apps wait for a project.
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
  -- one Worker invocation per due check or waiting app (each has its own request budget), at most 8
  select count(*) into v_due from public.app_monitor_checks
   where next_due_at <= now() and (claimed_at is null or claimed_at < now() - interval '10 minutes');
  select count(distinct package) into v_unadopted from public.play_key_apps b
   where not exists (select 1 from public.projects p where p.android_package = b.package)
     and (b.adopt_tried_at is null or b.adopt_tried_at < now() - interval '1 hour');
  for i in 1 .. least(v_due + v_unadopted, 8) loop
    perform public.app_monitor_kick();
  end loop;
end;
$$;
revoke all on function public.app_monitor_sweep() from public, anon, authenticated;

-- re-check every app now, so the new cards appear without waiting for the hourly check
update public.app_monitor_checks set next_due_at = now() where "check" = 'play';
