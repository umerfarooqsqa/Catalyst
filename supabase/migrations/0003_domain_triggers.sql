-- =====================================================================
-- 0003 — Domain automation triggers
--   * SLA deadline computed on bug create / severity change / assignment
--   * Notifications on assignment, status change, retest-ready, new comment
--   * closed_at / completed_at bookkeeping
-- =====================================================================

-- ---------------------------------------------------------------------
-- SLA deadline: project override -> global default (project_id NULL)
-- Recomputed when severity changes or the bug is (re)assigned while open.
-- ---------------------------------------------------------------------
create or replace function public.bugs_set_sla_deadline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hours integer;
begin
  select threshold_hours into v_hours
  from public.sla_settings
  where severity = new.severity
    and project_id = new.project_id
  limit 1;

  if v_hours is null then
    select threshold_hours into v_hours
    from public.sla_settings
    where severity = new.severity
      and project_id is null
    limit 1;
  end if;

  if tg_op = 'INSERT' then
    if v_hours is not null and new.sla_deadline is null then
      new.sla_deadline := now() + make_interval(hours => v_hours);
    end if;
  elsif tg_op = 'UPDATE' then
    if (new.severity is distinct from old.severity)
       or (new.assignee_id is distinct from old.assignee_id and old.assignee_id is null) then
      if v_hours is not null and new.status not in ('closed') then
        new.sla_deadline := now() + make_interval(hours => v_hours);
      end if;
    end if;
  end if;

  if new.status = 'closed' and old.status is distinct from 'closed' then
    new.closed_at := now();
  elsif new.status <> 'closed' then
    new.closed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bugs_sla on public.bugs;
create trigger trg_bugs_sla
  before insert or update on public.bugs
  for each row execute function public.bugs_set_sla_deadline();

-- ---------------------------------------------------------------------
-- Bug notifications
-- ---------------------------------------------------------------------
create or replace function public.bugs_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  -- assignment
  if new.assignee_id is not null
     and new.assignee_id is distinct from old.assignee_id
     and new.assignee_id <> coalesce(v_actor, '00000000-0000-0000-0000-000000000000') then
    insert into public.notifications (user_id, type, message, related_bug_id)
    values (new.assignee_id, 'assignment',
            'You were assigned bug: ' || new.title, new.id);
  end if;

  -- status change -> notify creator + assignee (except the actor)
  if new.status is distinct from old.status then
    insert into public.notifications (user_id, type, message, related_bug_id)
    select distinct on (p) p, 'status_change',
           'Bug "' || new.title || '" moved to ' || replace(new.status::text, '_', ' '),
           new.id
    from (select unnest(array[new.created_by, new.assignee_id]) as p) s
    where p is not null
      and p <> coalesce(v_actor, '00000000-0000-0000-0000-000000000000');

    -- ready for retest -> ping the original QA (created_by)
    if new.status = 'ready_for_retest' and new.created_by is not null
       and new.created_by <> coalesce(v_actor, '00000000-0000-0000-0000-000000000000') then
      insert into public.notifications (user_id, type, message, related_bug_id)
      values (new.created_by, 'retest_ready',
              'Bug "' || new.title || '" is fixed and ready for retest', new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bugs_notify on public.bugs;
create trigger trg_bugs_notify
  after update on public.bugs
  for each row execute function public.bugs_notify();

-- ---------------------------------------------------------------------
-- Task notifications + completed_at bookkeeping
-- ---------------------------------------------------------------------
create or replace function public.tasks_touch_completed()
returns trigger language plpgsql as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_completed on public.tasks;
create trigger trg_tasks_completed
  before update on public.tasks
  for each row execute function public.tasks_touch_completed();

create or replace function public.tasks_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_actor uuid := auth.uid();
begin
  if new.assignee_id is not null
     and new.assignee_id is distinct from old.assignee_id
     and new.assignee_id <> coalesce(v_actor, '00000000-0000-0000-0000-000000000000') then
    insert into public.notifications (user_id, type, message, related_task_id)
    values (new.assignee_id, 'assignment',
            'You were assigned task: ' || new.title, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_notify on public.tasks;
create trigger trg_tasks_notify
  after update on public.tasks
  for each row execute function public.tasks_notify();

-- ---------------------------------------------------------------------
-- Comment notifications: ping the other people on the bug/task
-- ---------------------------------------------------------------------
create or replace function public.comments_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_title text;
begin
  if new.bug_id is not null then
    select title into v_title from public.bugs where id = new.bug_id;
    insert into public.notifications (user_id, type, message, related_bug_id)
    select distinct on (p) p, 'comment', 'New comment on bug: ' || coalesce(v_title, ''), new.bug_id
    from (
      select created_by as p from public.bugs where id = new.bug_id
      union
      select assignee_id from public.bugs where id = new.bug_id
    ) s
    where p is not null and p <> coalesce(new.author_id, '00000000-0000-0000-0000-000000000000');
  elsif new.task_id is not null then
    select title into v_title from public.tasks where id = new.task_id;
    insert into public.notifications (user_id, type, message, related_task_id)
    select distinct on (p) p, 'comment', 'New comment on task: ' || coalesce(v_title, ''), new.task_id
    from (
      select created_by as p from public.tasks where id = new.task_id
      union
      select assignee_id from public.tasks where id = new.task_id
    ) s
    where p is not null and p <> coalesce(new.author_id, '00000000-0000-0000-0000-000000000000');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_comments_notify on public.comments;
create trigger trg_comments_notify
  after insert on public.comments
  for each row execute function public.comments_notify();

-- ---------------------------------------------------------------------
-- SLA breach sweep — call periodically (pg_cron if available, or from the
-- app). Creates one 'sla_breach' notification per newly-breached bug.
-- ---------------------------------------------------------------------
create or replace function public.sweep_sla_breaches()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with breached as (
    select b.id, b.title, b.assignee_id, b.created_by
    from public.bugs b
    where b.sla_deadline is not null
      and b.sla_deadline < now()
      and b.status not in ('closed', 'fixed', 'ready_for_retest')
  ), targets as (
    select br.id as bug_id, br.title, p as user_id
    from breached br
    cross join lateral (
      select unnest(array[br.assignee_id, br.created_by]) as p
    ) s(p)
    where p is not null
  )
  insert into public.notifications (user_id, type, message, related_bug_id)
  select t.user_id, 'sla_breach', 'SLA breached on bug: ' || t.title, t.bug_id
  from targets t
  where not exists (
    select 1 from public.notifications n
    where n.user_id = t.user_id
      and n.related_bug_id = t.bug_id
      and n.type = 'sla_breach'
  );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.sweep_sla_breaches() to authenticated;

-- Best-effort schedule via pg_cron (ignored if the extension is absent).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('catalyst-sla-sweep', '*/15 * * * *',
                          'select public.sweep_sla_breaches()');
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end;
$$;
