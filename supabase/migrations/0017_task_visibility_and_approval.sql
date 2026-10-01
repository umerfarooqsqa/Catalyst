-- =====================================================================
-- 0017 — Task privacy + done-needs-admin-approval workflow.
--   * A contributor now sees only tasks assigned to them (or created by
--     them); admin/manager/viewer are unaffected (unchanged full visibility).
--   * A task can no longer be marked 'done' directly by anyone but an
--     admin. Everyone else submits via the new 'pending_approval' status;
--     an admin then approves (-> done) or sends it back (-> any other
--     status). Mirrors the existing bugs fixed -> ready_for_retest pattern.
-- =====================================================================

-- ---------------------------------------------------------------------
-- New status value. Ordered right before 'done' so it reads naturally
-- in any UI that lists TASK_STATUSES in enum order.
-- ---------------------------------------------------------------------
alter type public.task_status add value if not exists 'pending_approval' before 'done';

-- ---------------------------------------------------------------------
-- Helper: is the current user a viewer? (admin/manager already covered
-- by is_qa_or_admin()). Needed so viewers keep their existing read-only
-- visibility into every sheet while contributors get narrowed.
-- ---------------------------------------------------------------------
create or replace function public.is_viewer()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select r.level = 'viewer'
       from public.profiles p join public.roles r on r.key = p.role
       where p.id = auth.uid()), false) $$;

grant execute on function public.is_viewer() to authenticated;

-- ---------------------------------------------------------------------
-- TASKS — narrow select to: admin/manager/viewer (unchanged), OR the
-- assignee, OR the creator. Insert/update/delete policies are untouched.
-- ---------------------------------------------------------------------
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select to authenticated
  using (
    public.is_qa_or_admin()
    or public.is_viewer()
    or assignee_id = auth.uid()
    or created_by = auth.uid()
  );

-- ---------------------------------------------------------------------
-- Only an admin may move a task INTO 'done' — i.e. approve it. Everyone
-- else's existing update rights (assignee/creator/manager) are otherwise
-- unchanged; they just can't set this one value themselves.
-- ---------------------------------------------------------------------
create or replace function public.tasks_enforce_approval()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'done' and old.status is distinct from 'done'
     and not public.is_admin() then
    raise exception 'Only an admin can approve a task as done.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_enforce_approval on public.tasks;
create trigger trg_tasks_enforce_approval
  before update on public.tasks
  for each row execute function public.tasks_enforce_approval();

-- ---------------------------------------------------------------------
-- Notifications: submitted-for-approval pings every admin; approved /
-- sent-back pings the assignee. Reuses the existing 'status_change'
-- notification type rather than growing the enum further.
-- ---------------------------------------------------------------------
create or replace function public.tasks_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_actor uuid := auth.uid();
begin
  -- assignment
  if new.assignee_id is not null
     and new.assignee_id is distinct from old.assignee_id
     and new.assignee_id <> coalesce(v_actor, '00000000-0000-0000-0000-000000000000') then
    insert into public.notifications (user_id, type, message, related_task_id)
    values (new.assignee_id, 'assignment',
            'You were assigned task: ' || new.title, new.id);
  end if;

  -- submitted for approval -> notify every admin (except the actor)
  if new.status = 'pending_approval' and old.status is distinct from 'pending_approval' then
    insert into public.notifications (user_id, type, message, related_task_id)
    select p.id, 'status_change',
           'Task "' || new.title || '" marked done — needs your approval', new.id
    from public.profiles p
    join public.roles r on r.key = p.role
    where r.level = 'admin'
      and p.id <> coalesce(v_actor, '00000000-0000-0000-0000-000000000000');
  end if;

  -- approved -> notify assignee + creator (except the actor)
  if new.status = 'done' and old.status is distinct from 'done' then
    insert into public.notifications (user_id, type, message, related_task_id)
    select distinct on (p) p, 'status_change',
           'Task "' || new.title || '" approved and marked done', new.id
    from (select unnest(array[new.assignee_id, new.created_by]) as p) s
    where p is not null
      and p <> coalesce(v_actor, '00000000-0000-0000-0000-000000000000');
  end if;

  -- sent back from pending_approval (rejected) -> notify the assignee
  if old.status = 'pending_approval' and new.status not in ('pending_approval', 'done')
     and new.assignee_id is not null
     and new.assignee_id <> coalesce(v_actor, '00000000-0000-0000-0000-000000000000') then
    insert into public.notifications (user_id, type, message, related_task_id)
    values (new.assignee_id, 'status_change',
            'Task "' || new.title || '" sent back for more work', new.id);
  end if;

  return new;
end;
$$;
