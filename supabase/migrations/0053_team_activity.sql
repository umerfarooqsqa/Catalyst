-- =====================================================================
-- 0053: team activity for the dashboard heatmap (assigned and completed work per person per day).
--
-- Asked for by the user (2026-10-07): "a heat graph of people with tasks assigned and completed".
-- Built from audit_log (0020), which records every bug and task insert/update with its time:
--   * assigned:  a bug/task created with an assignee, or its assignee changed to someone.
--   * completed: a bug moving from open / in progress / reopened to fixed, ready for retest or
--                closed; a task moving to "pending approval" (sent for approval) or done from
--                any other status. pending_approval -> done and fixed -> closed are the same
--                piece of work, so they don't count twice.
--   * credited to whoever the item was assigned to at that moment. Completing an unassigned
--     item (e.g. QA closing a duplicate) counts for nobody: this is a view of assigned work.
--   * items that were later deleted are left out (tests, duplicates).
-- Days are Asia/Karachi days. audit_log is admin-only, so this is SECURITY DEFINER and refuses
-- anyone who isn't QA or an admin.
-- =====================================================================

create or replace function public.team_activity(p_days integer default 28)
returns table (person_id uuid, full_name text, day date, kind text, assigned integer, completed integer)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_days  integer := least(greatest(coalesce(p_days, 28), 1), 366);
  v_from  timestamptz := ((now() at time zone 'Asia/Karachi')::date - (v_days - 1)) at time zone 'Asia/Karachi';
begin
  if not public.is_qa_or_admin() then
    raise exception 'Only QA or an admin can see team activity.' using errcode = '42501';
  end if;

  return query
  with ev as (
    select a.entity_type, a.entity_id, a.created_at, a.action, a.actor_id,
           case when a.action = 'insert' then nullif(a.changes->>'assignee_id', '')
                when a.changes ? 'assignee_id' then coalesce(a.changes->'assignee_id'->>'to', '-') end as asg_set,
           case when a.action = 'update' and a.changes ? 'status' then a.changes->'status'->>'from' end as st_from,
           case when a.action = 'update' and a.changes ? 'status' then a.changes->'status'->>'to' end as st_to
      from public.audit_log a
     where a.entity_type in ('bugs', 'tasks')
       and a.action in ('insert', 'update')
       and not exists (select 1 from public.audit_log d
                        where d.entity_type = a.entity_type and d.entity_id = a.entity_id and d.action = 'delete')
  ), grp as (
    -- the assignee in force at each row: the last assignee set at or before it
    select ev.*, count(ev.asg_set) over (partition by ev.entity_type, ev.entity_id order by ev.created_at
                                         rows between unbounded preceding and current row) g
      from ev
  ), cur as (
    select grp.*, nullif(first_value(grp.asg_set) over (partition by grp.entity_type, grp.entity_id, grp.g
                                                        order by grp.created_at), '-')::uuid as assignee
      from grp
  ), hits as (
    select c.assignee as person, c.created_at, c.entity_type, 1 as a, 0 as d
      from cur c
     where c.asg_set is not null and c.asg_set <> '-'
    union all
    select c.assignee, c.created_at, c.entity_type, 0, 1
      from cur c
     where c.assignee is not null
       and ((c.entity_type = 'bugs'
            and c.st_to in ('fixed', 'ready_for_retest', 'closed')
            and c.st_from in ('open', 'in_progress', 'reopened'))
        or (c.entity_type = 'tasks'
            and c.st_to in ('pending_approval', 'done')
            and c.st_from not in ('pending_approval', 'done')))
  )
  select h.person, p.full_name, (h.created_at at time zone 'Asia/Karachi')::date,
         case h.entity_type when 'bugs' then 'bug' else 'task' end,
         sum(h.a)::integer, sum(h.d)::integer
    from hits h
    join public.profiles p on p.id = h.person
   where h.created_at >= v_from
   group by 1, 2, 3, 4;
end;
$$;

revoke all on function public.team_activity(integer) from public, anon;
grant execute on function public.team_activity(integer) to authenticated;
