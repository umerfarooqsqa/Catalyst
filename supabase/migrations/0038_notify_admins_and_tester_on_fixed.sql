-- =====================================================================
-- 0038: when a bug is marked Fixed, tell the tester and every admin at once.
--
-- Replaces public.bugs_notify() (0003). Everything else is unchanged:
-- assignment pings, the generic "moved to <status>" ping for other status
-- changes, and the ready-for-retest ping.
--
-- New: a move to 'fixed' (by a developer from My Queue / the drawer, or by
-- anyone else) sends ONE notification to each of:
--   - the tester who logged the bug (bugs.created_by)
--   - every user whose role level is 'admin'
--   - the assignee, when someone other than them marked it fixed
-- never to the person who marked it. It says who marked it fixed and in which
-- app version, as type 'retest_ready' ("fixed, please retest"). It replaces the
-- generic "moved to fixed" ping, so nobody gets two.
--
-- "Instantly": notifications are on the realtime channel (0016), so the bell
-- updates live for anyone with the portal open. The same insert drives the Web
-- Push webhook (0016), which reaches closed apps once that webhook is configured.
-- =====================================================================

create or replace function public.bugs_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_nobody  uuid := '00000000-0000-0000-0000-000000000000';
  v_by      text;
  v_version text;
begin
  -- assignment
  if new.assignee_id is not null
     and new.assignee_id is distinct from old.assignee_id
     and new.assignee_id <> coalesce(v_actor, v_nobody) then
    insert into public.notifications (user_id, type, message, related_bug_id)
    values (new.assignee_id, 'assignment',
            'You were assigned bug: ' || new.title, new.id);
  end if;

  if new.status is distinct from old.status then
    if new.status = 'fixed' then
      -- marked fixed -> tester + every admin (+ the assignee if someone else did it)
      select full_name into v_by from public.profiles where id = v_actor;
      select version into v_version from public.releases where id = new.release_id;
      insert into public.notifications (user_id, type, message, related_bug_id)
      select s.p, 'retest_ready',
             'Bug "' || new.title || '" was marked fixed'
               || coalesce(' by ' || v_by, '')
               || coalesce(' in v' || v_version, '')
               || '. Please retest it.',
             new.id
      from (
        select new.created_by as p
        union
        select new.assignee_id
        union
        select pr.id from public.profiles pr join public.roles r on r.key = pr.role
         where r.level = 'admin'
      ) s
      where s.p is not null
        and s.p <> coalesce(v_actor, v_nobody);
    else
      -- other status changes -> notify creator + assignee (except the actor)
      insert into public.notifications (user_id, type, message, related_bug_id)
      select distinct on (p) p, 'status_change',
             'Bug "' || new.title || '" moved to ' || replace(new.status::text, '_', ' '),
             new.id
      from (select unnest(array[new.created_by, new.assignee_id]) as p) s
      where p is not null
        and p <> coalesce(v_actor, v_nobody);
    end if;

    -- ready for retest -> ping the original QA (created_by)
    if new.status = 'ready_for_retest' and new.created_by is not null
       and new.created_by <> coalesce(v_actor, v_nobody) then
      insert into public.notifications (user_id, type, message, related_bug_id)
      values (new.created_by, 'retest_ready',
              'Bug "' || new.title || '" is fixed and ready for retest', new.id);
    end if;
  end if;

  return new;
end;
$$;
revoke all on function public.bugs_notify() from public, anon, authenticated;
