-- =====================================================================
-- 0040 — Lead and junior developers.
--
-- 1. profiles.dev_rank: 'lead', 'junior' or NULL (a regular developer).
--    Only meaningful for contributor-level (developer) roles; an admin sets
--    it on Admin → Users. Only an admin may change a user's role or rank:
--    profiles_update_self let anyone change their own row, role included,
--    so a user could make themselves an admin. That is closed here too.
--
-- 2. A lead developer can hand a bug or task that is assigned to them to a
--    junior developer who can see the project (same platform rule as
--    can_see_project), re-hand it to another junior, or take it back.
--    bugs.delegated_by / tasks.delegated_by record the lead, so the lead
--    still sees a task they handed on (tasks are private to their
--    assignee, 0017) and can follow it from My Queue. The lead changes
--    nothing else on a handed-on item; the junior works it with the usual
--    developer rights (0034 for bugs, 0017 for tasks).
--
--    delegated_by is set only by the triggers below, never by the client.
--    When QA/admin (or the automation service role) reassigns an item, it
--    is cleared: the item is no longer the lead's to hand on.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. profiles.dev_rank, admin-only
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists dev_rank text
  check (dev_rank in ('lead', 'junior'));

create or replace function public.profiles_protect_admin_fields()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and (new.role is distinct from old.role or new.dev_rank is distinct from old.dev_rank) then
    raise exception 'Only an admin can change a user''s role or developer rank.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_protect_admin_fields() from public, anon, authenticated;

drop trigger if exists trg_profiles_protect_admin_fields on public.profiles;
create trigger trg_profiles_protect_admin_fields
  before update on public.profiles
  for each row execute function public.profiles_protect_admin_fields();

-- Is the current user a lead developer?
create or replace function public.is_lead_developer()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select r.level = 'contributor' and p.dev_rank = 'lead'
       from public.profiles p join public.roles r on r.key = p.role
       where p.id = auth.uid()), false) $$;
grant execute on function public.is_lead_developer() to authenticated;

-- Is this user a junior developer who can see this project?
create or replace function public.is_junior_developer_for(p_user uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
       select 1 from public.profiles p
         join public.roles r on r.key = p.role
         join public.projects pr on pr.id = p_project
        where p.id = p_user and p.dev_rank = 'junior' and r.level = 'contributor'
          and (r.platform is null or r.platform = pr.platform)) $$;
grant execute on function public.is_junior_developer_for(uuid, uuid) to authenticated;

-- The new delegated_by for a reassignment made by a developer, or an error.
-- Called only from the bug/task triggers below.
create or replace function public.delegation_target(
  p_old_assignee uuid, p_old_delegated_by uuid, p_new_assignee uuid, p_project uuid)
returns uuid language plpgsql stable security definer set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if not public.is_lead_developer() then
    raise exception 'Only QA, an admin or a lead developer can reassign this.'
      using errcode = '42501';
  end if;
  if v_uid is distinct from p_old_assignee and v_uid is distinct from p_old_delegated_by then
    raise exception 'A lead developer can hand on only work assigned to them.'
      using errcode = '42501';
  end if;
  if p_new_assignee is null then
    raise exception 'Pick a junior developer, or take it back yourself.' using errcode = '42501';
  end if;
  if p_new_assignee = v_uid then
    return null;  -- taken back
  end if;
  if not public.is_junior_developer_for(p_new_assignee, p_project) then
    raise exception 'You can hand work only to a junior developer who can see this project.'
      using errcode = '42501';
  end if;
  return v_uid;
end;
$$;
revoke all on function public.delegation_target(uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. delegated_by columns
-- ---------------------------------------------------------------------
alter table public.bugs add column if not exists delegated_by uuid
  references public.profiles(id) on delete set null;
alter table public.tasks add column if not exists delegated_by uuid
  references public.profiles(id) on delete set null;
create index if not exists bugs_delegated_by_idx on public.bugs(delegated_by);
create index if not exists tasks_delegated_by_idx on public.tasks(delegated_by);

-- ---------------------------------------------------------------------
-- 2a. Bugs: 0034's developer-rights trigger, plus the lead's hand-on.
-- ---------------------------------------------------------------------
create or replace function public.bugs_enforce_developer_rights()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  -- columns other triggers maintain, which a status change may move
  v_auto text[] := array['status', 'updated_at', 'closed_at'];
begin
  if auth.uid() is null or public.is_qa_or_admin() then
    -- service role (automation API), QA, backoffice, admin
    if new.assignee_id is distinct from old.assignee_id then
      new.delegated_by := null;
    end if;
    return new;
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    if old.status = 'closed' then
      raise exception 'This bug is closed. Only QA can reopen it.' using errcode = '42501';
    end if;
    new.delegated_by := public.delegation_target(
      old.assignee_id, old.delegated_by, new.assignee_id, new.project_id);
    v_auto := v_auto || array['assignee_id', 'delegated_by'];
  end if;
  if (to_jsonb(new) - v_auto) is distinct from (to_jsonb(old) - v_auto) then
    raise exception 'Developers can only change a bug''s status (to In progress or Fixed).'
      using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if old.status = 'closed' then
      raise exception 'This bug is closed. Only QA can reopen it.' using errcode = '42501';
    end if;
    if new.status not in ('in_progress', 'fixed') then
      raise exception 'Developers can mark a bug In progress or Fixed; QA verifies and closes it.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.bugs_enforce_developer_rights() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2b. Tasks: who may reassign, and what the lead may do once handed on.
-- ---------------------------------------------------------------------
create or replace function public.tasks_enforce_delegation()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_moving text[] := array['assignee_id', 'delegated_by', 'updated_at'];
begin
  if v_uid is null or public.is_qa_or_admin() then
    if new.assignee_id is distinct from old.assignee_id then
      new.delegated_by := null;
    end if;
    return new;
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    new.delegated_by := public.delegation_target(
      old.assignee_id, old.delegated_by, new.assignee_id, new.project_id);
  elsif new.delegated_by is distinct from old.delegated_by then
    raise exception 'delegated_by is set by the portal.' using errcode = '42501';
  end if;
  -- A lead looking after a task they handed on may reassign it or take it back; the junior works it.
  if old.delegated_by = v_uid
     and v_uid is distinct from old.assignee_id and v_uid is distinct from old.created_by
     and (to_jsonb(new) - v_moving) is distinct from (to_jsonb(old) - v_moving) then
    raise exception 'You handed this task to a junior developer. You can reassign it or take it back.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.tasks_enforce_delegation() from public, anon, authenticated;

drop trigger if exists trg_tasks_enforce_delegation on public.tasks;
create trigger trg_tasks_enforce_delegation
  before update on public.tasks
  for each row execute function public.tasks_enforce_delegation();

-- The lead keeps seeing (and may update, within the trigger's limits) a task they handed on.
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select to authenticated
  using (
    public.can_see_project(project_id)
    and (
      public.is_qa_or_admin()
      or public.is_viewer()
      or assignee_id = auth.uid()
      or created_by = auth.uid()
      or delegated_by = auth.uid()
    )
  );

drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update to authenticated
  using (public.is_qa_or_admin() or assignee_id = auth.uid() or created_by = auth.uid()
         or delegated_by = auth.uid())
  with check (public.is_qa_or_admin() or assignee_id = auth.uid() or created_by = auth.uid()
              or delegated_by = auth.uid());

-- Keep the task history visible to exactly who sees the task (see 0019).
drop policy if exists "task_audit_log_select" on public.task_audit_log;
create policy "task_audit_log_select" on public.task_audit_log
  for select to authenticated
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_audit_log.task_id
        and (
          public.is_qa_or_admin()
          or public.is_viewer()
          or t.assignee_id = auth.uid()
          or t.created_by = auth.uid()
          or t.delegated_by = auth.uid()
        )
    )
  );
