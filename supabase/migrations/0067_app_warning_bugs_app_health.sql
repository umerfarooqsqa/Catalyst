-- =====================================================================
-- 0067: app-warning bugs go to App health (2026-11-02, the user: "the critical app warnings
-- remain unassigned although i have assigned app health to user roles")
--
-- 0065 filed the bugs with no category, so trg_bugs_default_assignee could only use the
-- project's no-category developer, which none of these projects has. They are now filed under
-- the App health role category (area 'app_health', 0058), so the usual routing applies: the
-- project's App health person (Bugs page -> Developers) if set, else the least busy App health
-- member who can see the project (least_busy_in_category, 0043: assignable roles only, so an
-- Admin-role member isn't picked), else the project's developer.
-- The open app-monitor bugs that are still unassigned get the same treatment now.
-- =====================================================================

create or replace function public.app_warning_file_bug(p_id uuid, p_again boolean default false)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  w public.app_warnings;
  v_release uuid;
  v_bug uuid;
  v_app text := rtrim(public.email_config('email_app_url', 'https://catalyst.umerfarooqsqa.workers.dev'), '/');
begin
  select * into w from public.app_warnings where id = p_id for update;
  if not found then return null; end if;

  if w.bug_id is not null then
    if p_again then
      update public.bugs set status = 'reopened'
       where id = w.bug_id and status in ('fixed', 'ready_for_retest', 'closed');
    end if;
    return w.bug_id;
  end if;
  -- filed before and deleted by a person: only a comeback files it again
  if w.bug_filed_at is not null and not p_again then return null; end if;

  select rl.id into v_release from public.releases rl
   where rl.project_id = w.project_id and rl.version = w.data ->> 'version' limit 1;
  if v_release is null then
    select rl.id into v_release from public.releases rl join public.projects p on p.id = rl.project_id
     where rl.project_id = w.project_id and rl.version = p.current_version limit 1;
  end if;

  insert into public.bugs (project_id, title, description, severity, priority, status,
                           source, automation_key, release_id, created_by, area)
  values (w.project_id, w.title,
          concat_ws(E'\n\n',
            nullif(trim(coalesce(w.detail, '')), ''),
            'Found by catalyst''s app monitor (' || case w.source
                when 'target_api' then 'target API check'
                when 'releases' then 'Google Play releases'
                when 'play_email' then 'Play Console email'
                when 'vitals' then 'Android vitals'
                else w.source end
              || ') on ' || to_char(w.first_seen_at at time zone 'Asia/Karachi', 'DD Mon YYYY') || '.',
            case when w.action_url like 'http%' then 'Where to fix it: ' || w.action_url end,
            'App warning card: ' || v_app || '/my-queue#w-' || w.id),
          'critical', 'high', 'open',
          'app_monitor', 'app_warning:' || w.id, v_release, null,
          (select key from public.role_categories where key = 'app_health'))
  on conflict (project_id, automation_key) where automation_key is not null do nothing
  returning id into v_bug;
  if v_bug is null then
    -- the key is taken: a bug filed for this warning before (kept, so not deleted)
    select id into v_bug from public.bugs
     where project_id = w.project_id and automation_key = 'app_warning:' || w.id;
    if p_again then
      update public.bugs set status = 'reopened'
       where id = v_bug and status in ('fixed', 'ready_for_retest', 'closed');
    end if;
  end if;

  update public.app_warnings set bug_id = v_bug, bug_filed_at = coalesce(bug_filed_at, now()) where id = w.id;
  return v_bug;
end;
$$;
revoke all on function public.app_warning_file_bug(uuid, boolean) from public, anon, authenticated;
grant execute on function public.app_warning_file_bug(uuid, boolean) to service_role;

-- the bugs filed so far: App health, and an assignee by the same rule (one at a time, so the
-- "least busy" count sees each assignment before the next)
do $$
declare
  b record;
  v_to uuid;
begin
  for b in
    select id, project_id from public.bugs
     where source = 'app_monitor' and assignee_id is null and status <> 'closed'
     order by created_at
  loop
    select developer_id into v_to from public.project_area_developers
     where project_id = b.project_id and area = 'app_health';
    v_to := coalesce(v_to, public.least_busy_in_category('app_health', b.project_id),
                     (select assigned_developer_id from public.projects where id = b.project_id));
    update public.bugs set area = 'app_health', assignee_id = v_to where id = b.id;
  end loop;
  update public.bugs set area = 'app_health'
   where source = 'app_monitor' and area is null;
end;
$$;
