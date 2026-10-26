-- =====================================================================
-- 0058: app warnings go only to the "App health" role category, and only serious ones.
--
-- Decided with the user (2026-10-26), replacing "admins and QA" from 0056:
--   * A role category, app_health ("App health (Google Play)"), holds the people who handle
--     app warnings. Only they get the bell, the email and the cards in My Queue. Admins
--     manage the members on Admin -> Role categories (profiles.skills, 0043), and still see
--     every warning on Admin -> Google Play.
--   * Only serious problems notify and show as cards: severity critical, from the app's own
--     checks (releases, vitals, target API, portal, Play Console emails). Amber "approaching"
--     warnings and the monitor's own problems ("can't be checked", "checks have stopped") are
--     listed on Admin -> Google Play only, with no bell and no email.
--   * Seeded member: Umer Farooq (admin, who set this up). Add or remove people on the
--     Role categories page.
-- =====================================================================

insert into public.role_categories (key, label, short_label, description, color, sort_order)
values ('app_health', 'App health (Google Play)', 'App health',
        'Handles serious warnings about the Android apps found on Google Play (releases, crashes, target API deadlines, Play Console policy emails). Gets them as cards in My Queue, by bell and by email.',
        'rose', 90)
on conflict (key) do nothing;

update public.profiles
   set skills = array(select distinct s from unnest(coalesce(skills, '{}') || array['app_health']) s)
 where full_name = 'Umer Farooq' and not ('app_health' = any (coalesce(skills, '{}')));

-- Is the signed-in user in App health?
create or replace function public.in_app_health()
returns boolean
language sql stable security definer
set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and 'app_health' = any (skills)) $$;
revoke all on function public.in_app_health() from public, anon;
grant execute on function public.in_app_health() to authenticated;

-- Only serious app problems reach people, and only App health members.
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
  if w.severity <> 'critical' or w.source like 'monitor%' then
    return;  -- amber and monitor problems: Admin -> Google Play only
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
    insert into public.notifications (user_id, type, message, related_warning_id)
    values (r.user_id, 'app_warning',
            v_project.name || ': ' || w.title || case when p_event = 'reopened' then ' (again)' else '' end,
            w.id);
    insert into public.email_outbox (recipient_id, recipient_email, kind, priority, items)
    select r.user_id, ne.email, 'critical', 0, jsonb_build_array(v_item)
      from public.notification_emails ne
     where ne.user_id = r.user_id
       and not exists (select 1 from public.email_opt_outs o
                        where o.user_id = r.user_id and o.event_type in ('all', 'app_warning'));
  end loop;
exception when others then
  raise warning 'app_warning_notify failed for %: %', p_id, sqlerrm;
end;
$$;
revoke all on function public.app_warning_notify(uuid, text) from public, anon, authenticated;

-- App health members see the warnings too (even developer-level members), on projects they can see.
drop policy if exists app_warnings_select on public.app_warnings;
create policy app_warnings_select on public.app_warnings
  for select to authenticated
  using ((not public.is_contributor() or public.in_app_health()) and public.can_see_project(project_id));

-- ...and can close them.
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
  if not ((public.is_qa_or_admin() or public.in_app_health()) and public.can_see_project(v_project)) then
    raise exception 'Only App health members, QA or an admin can close app warnings';
  end if;
  update public.app_warnings
     set status = 'closed', closed_by = auth.uid(), closed_at = now(), close_note = nullif(trim(p_note), '')
   where id = p_id and status = 'open';
end;
$$;
revoke all on function public.app_warning_close(uuid, text) from public, anon;
grant execute on function public.app_warning_close(uuid, text) to authenticated;
