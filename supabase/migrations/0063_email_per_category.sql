-- =====================================================================
-- 0063: "Email me" per My Queue tab, per person (2026-10-28, asked by the user)
--
-- The user: "add option of send emails in my queue for each category to allow emails
-- notifications". Each App health member switches emails on or off per tab of My Queue's
-- App warnings. The bell follows the same switch, so cards, bells and emails keep matching
-- (the user's earlier report). With no row, a tab keeps its default: the four red tabs
-- (critical, new_crashes, rates, live_bugs) on, not_critical and negligible off: what 0062
-- did.
--
-- app_warning_category() files a warning exactly as lib/monitor/levels.ts::warningLevel does
-- (the PGlite test compares the two on every kind): keep them in step.
-- =====================================================================

create or replace function public.app_warning_category(p_kind text, p_severity text, p_source text, p_active boolean)
returns text
language sql immutable
set search_path = public
as $$
  select case
    when not p_active then 'negligible'
    when p_source like 'monitor%' and p_source not like 'monitor_stale%' then 'negligible'
    when p_kind in ('release_name', 'reporting_api_disabled') then 'negligible'
    when p_kind = 'critical_bugs_live' then 'live_bugs'
    when p_severity = 'critical' and p_kind in ('crash_rate', 'anr_rate', 'crash_rate_device', 'anr_rate_device') then 'rates'
    when p_severity = 'critical' and p_kind = 'new_crash' then 'new_crashes'
    when public.app_warning_is_critical(p_kind, p_severity) then 'critical'
    else 'not_critical'
  end;
$$;
grant execute on function public.app_warning_category(text, text, text, boolean) to authenticated, service_role;

create table if not exists public.app_warning_email_prefs (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  category   text not null check (category in ('critical', 'new_crashes', 'rates', 'live_bugs', 'not_critical', 'negligible')),
  enabled    boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);
alter table public.app_warning_email_prefs enable row level security;
drop policy if exists app_warning_email_prefs_select on public.app_warning_email_prefs;
create policy app_warning_email_prefs_select on public.app_warning_email_prefs
  for select to authenticated using (user_id = auth.uid());
drop policy if exists app_warning_email_prefs_insert on public.app_warning_email_prefs;
create policy app_warning_email_prefs_insert on public.app_warning_email_prefs
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists app_warning_email_prefs_update on public.app_warning_email_prefs;
create policy app_warning_email_prefs_update on public.app_warning_email_prefs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.app_warning_email_prefs to authenticated;

-- is this person emailed (and belled) about this tab? their switch, else the tab's default
create or replace function public.app_warning_emails_on(p_user uuid, p_category text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select enabled from public.app_warning_email_prefs where user_id = p_user and category = p_category),
    p_category in ('critical', 'new_crashes', 'rates', 'live_bugs'));
$$;
revoke all on function public.app_warning_emails_on(uuid, text) from public, anon;
grant execute on function public.app_warning_emails_on(uuid, text) to authenticated, service_role;

create or replace function public.app_warning_notify(p_id uuid, p_event text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  w public.app_warnings;
  v_project public.projects;
  v_item jsonb;
  v_cat text;
  v_told int := 0;
  r record;
begin
  select * into w from public.app_warnings where id = p_id;
  -- the card's My Queue tab decides; each person switches emails per tab (0063)
  v_cat := public.app_warning_category(w.kind, w.severity, w.source, w.active);
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
       and public.app_warning_emails_on(pr.id, v_cat)
  loop
    begin
      insert into public.notifications (user_id, type, message, related_warning_id)
      values (r.user_id, 'app_warning',
              v_project.name || ': ' || w.title || case when p_event = 'reopened' then ' (again)' else '' end,
              w.id);
      perform public.app_warning_email(r.user_id, v_item);
      v_told := v_told + 1;
    exception when others then
      raise warning 'app_warning_notify failed for % / user %: %', p_id, r.user_id, sqlerrm;
    end;
  end loop;
  -- only when someone was told: an amber card nobody heard about must still ring when it turns
  -- red the same day (app_warnings_sync throttles "worse" by notified_at)
  if v_told > 0 then
    update public.app_warnings set notified_at = now() where id = p_id;
  end if;
end;
$$;
revoke all on function public.app_warning_notify(uuid, text) from public, anon, authenticated;

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
  -- only sent for serious mails (lib/monitor/play-mail.ts): the Critical tab's switch (0063)
  for r in select pr.id as user_id from public.profiles pr
            where 'app_health' = any (pr.skills) and public.app_warning_emails_on(pr.id, 'critical') loop
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
