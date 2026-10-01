-- =====================================================================
-- 0019 — Task audit log. Every create / status / assignee / priority /
-- due_date / title / description change on a task is recorded
-- automatically (actor + timestamp), so there's a timestamped history
-- per task independent of the comments thread. Rows are written only by
-- the SECURITY DEFINER trigger below — no direct insert/update/delete
-- policy is granted to authenticated users, so the log can't be edited
-- or backdated from the app.
-- =====================================================================

create table public.task_audit_log (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  from_value  text,
  to_value    text,
  created_at  timestamptz not null default now()
);

create index task_audit_log_task_idx on public.task_audit_log(task_id, created_at);

alter table public.task_audit_log enable row level security;

-- Same visibility as the task itself (mirrors tasks_select from 0017 —
-- admin/manager/viewer see every task's log, a contributor only theirs).
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
        )
    )
  );

-- ---------------------------------------------------------------------
-- Trigger: logs task creation and field-level changes on update.
-- ---------------------------------------------------------------------
create or replace function public.tasks_audit_log()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_old_assignee text;
  v_new_assignee text;
begin
  if tg_op = 'INSERT' then
    insert into public.task_audit_log (task_id, actor_id, action, to_value)
    values (new.id, v_actor, 'created', new.title);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.task_audit_log (task_id, actor_id, action, from_value, to_value)
    values (new.id, v_actor, 'status_changed', old.status::text, new.status::text);
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    select full_name into v_old_assignee from public.profiles where id = old.assignee_id;
    select full_name into v_new_assignee from public.profiles where id = new.assignee_id;
    insert into public.task_audit_log (task_id, actor_id, action, from_value, to_value)
    values (new.id, v_actor, 'assignee_changed', v_old_assignee, v_new_assignee);
  end if;

  if new.priority is distinct from old.priority then
    insert into public.task_audit_log (task_id, actor_id, action, from_value, to_value)
    values (new.id, v_actor, 'priority_changed', old.priority::text, new.priority::text);
  end if;

  if new.due_date is distinct from old.due_date then
    insert into public.task_audit_log (task_id, actor_id, action, from_value, to_value)
    values (new.id, v_actor, 'due_date_changed', old.due_date::text, new.due_date::text);
  end if;

  if new.title is distinct from old.title then
    insert into public.task_audit_log (task_id, actor_id, action, from_value, to_value)
    values (new.id, v_actor, 'title_edited', old.title, new.title);
  end if;

  if new.description is distinct from old.description then
    insert into public.task_audit_log (task_id, actor_id, action)
    values (new.id, v_actor, 'description_edited');
  end if;

  return new;
end;
$$;

revoke all on function public.tasks_audit_log() from public, anon, authenticated;

drop trigger if exists trg_tasks_audit_insert on public.tasks;
create trigger trg_tasks_audit_insert
  after insert on public.tasks
  for each row execute function public.tasks_audit_log();

drop trigger if exists trg_tasks_audit_update on public.tasks;
create trigger trg_tasks_audit_update
  after update on public.tasks
  for each row execute function public.tasks_audit_log();
