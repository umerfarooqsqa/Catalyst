-- =====================================================================
-- 0043: role categories, and auto-assignment by them.
--
-- 1. role_categories: the work areas an admin manages on Admin -> Role
--    categories (decided with the user, 2026-10-01). It replaces the fixed
--    four of 0041/0042 (frontend, backend, database, devops), which are
--    seeded here with their suggestion keywords. A category's key is what
--    bugs.area, tasks.area, base_page.area, bug_categories.default_area and
--    profiles.skills hold; it never changes once made.
--      - deleting a category clears it from bugs, tasks, library entries,
--        category defaults and people's skills, and drops its project
--        developers.
--
-- 2. project_area_developers(project, area, developer): the project's
--    person per category, replacing projects.frontend/backend/database/
--    devops_developer_id (copied over, then dropped). The platform check of
--    0035 applies to it. projects.assigned_developer_id stays the developer
--    for bugs with no category.
--
-- 3. Auto-assignment (decided with the user):
--      - a task with a category and no assignee goes to the least busy
--        person in that category who can see the project;
--      - a bug with a category and no assignee goes to the project's
--        person for it, else the least busy person in it, else the
--        project's developer; a bug with no category goes to the
--        project's developer (0035).
--    "Least busy" = fewest open tasks + open bugs assigned (bugs that are
--    fixed / ready for retest / closed don't count), ties by name. Only
--    people in an assignable role.
--
-- 4. tasks.area (a category), and an assignment notification when a task is
--    created already assigned to someone else (tasks_notify only fired on
--    update, so auto-assigned tasks would arrive silently).
--
-- 5. Categories that span every platform (decided with the user: backend and
--    DBA work isn't Android- or iOS-specific): role_categories.all_platforms.
--    People in such a category can be a project's person for it, and be
--    auto-assigned its work, on any platform's project, and they see every
--    platform's projects (user_platform() is NULL for them). A
--    platform-specific category (frontend) still follows the role's platform.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. role_categories
-- ---------------------------------------------------------------------
create table if not exists public.role_categories (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique
              check (key ~ '^[a-z][a-z0-9_]{0,30}$' and key <> 'none'),
  label       text not null,               -- "Database (DBA)"
  short_label text not null,               -- "Database": badges, skills, filters
  description text,
  keywords    text[] not null default '{}', -- the suggestion's hints
  color       text not null default 'slate',
  all_platforms boolean not null default false, -- the work isn't Android/iOS-specific (5.)
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_role_categories_updated on public.role_categories;
create trigger trg_role_categories_updated before update on public.role_categories
  for each row execute procedure public.touch_updated_at();

create or replace function public.role_categories_key_fixed()
returns trigger language plpgsql as $$
begin
  if new.key is distinct from old.key then
    raise exception 'A role category''s key can''t change; add a new category instead.' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists trg_role_categories_key_fixed on public.role_categories;
create trigger trg_role_categories_key_fixed before update on public.role_categories
  for each row execute function public.role_categories_key_fixed();

insert into public.role_categories (key, label, short_label, description, color, sort_order, keywords) values
  ('frontend', 'Frontend (app)', 'Frontend', 'The app itself: screens, layout, navigation.', 'sky', 10, array[
    'screen','button','layout','alignment','aligned','overlap','overlaps','cut off','truncated','font',
    'colour','color','icon','image','scroll','scrolling','keyboard','tab','tab bar','navigation','navigate',
    'back button','dark mode','ui','display','text field','popup','pop-up','splash','drawer','menu',
    'spinner','animation','landscape','portrait','tap','swipe','toast']),
  ('backend', 'Backend (server/API)', 'Backend', 'The trading server/API: wrong data, failed orders, feed, login service.', 'violet', 20, array[
    'api','servlet','timeout','timed out','response','socket','feed','price','prices','rate','rates',
    'balance','statement','ledger','order rejected','not updating','wrong data','incorrect data','sync',
    'latency','login failed','invalid pin','otp not received','otp','settlement','margin','portfolio value',
    'holdings','trade not executed','delayed','500','server error']),
  ('database', 'Database (DBA)', 'Database', 'The data store: queries, missing or duplicate records, deadlocks.', 'amber', 30, array[
    'database','db','dba','sql','query','queries','deadlock','duplicate records','duplicate entries',
    'duplicate rows','records missing','data missing','missing records','stored procedure','index','table',
    'migration','constraint','data corruption','rollback','transaction','replication','slow query',
    'oracle','postgres','mysql']),
  ('devops', 'DevOps (servers, deploys)', 'DevOps', 'Servers, deployments and infrastructure: downtime, SSL, gateways.', 'emerald', 40, array[
    'deploy','deployment','deployed','downtime','outage','server down','ssl','certificate','dns','502',
    '503','504','gateway','bad gateway','load balancer','cpu','memory','disk','disk full','pipeline',
    'build failed','environment','staging','uptime','backup','monitoring','docker','kubernetes','nginx',
    'firewall','vpn'])
on conflict (key) do nothing;
update public.role_categories set all_platforms = true where key in ('backend', 'database');

alter table public.role_categories enable row level security;
drop policy if exists role_categories_select on public.role_categories;
create policy role_categories_select on public.role_categories
  for select to anon, authenticated using (true);   -- names and keywords only, like bug_categories
drop policy if exists role_categories_admin_write on public.role_categories;
create policy role_categories_admin_write on public.role_categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop trigger if exists trg_audit_log on public.role_categories;
create trigger trg_audit_log after insert or update or delete on public.role_categories
  for each row execute function public.audit_log_row();

-- The fixed lists of 0041/0042 become references to role_categories.
alter table public.bugs drop constraint if exists bugs_area_check;
alter table public.bugs drop constraint if exists bugs_area_fkey;
alter table public.bugs add constraint bugs_area_fkey
  foreign key (area) references public.role_categories(key) on delete set null;

alter table public.base_page drop constraint if exists base_page_area_check;
alter table public.base_page drop constraint if exists base_page_area_fkey;
alter table public.base_page add constraint base_page_area_fkey
  foreign key (area) references public.role_categories(key) on delete set null;

alter table public.bug_categories drop constraint if exists bug_categories_default_area_check;
alter table public.bug_categories drop constraint if exists bug_categories_default_area_fkey;
alter table public.bug_categories add constraint bug_categories_default_area_fkey
  foreign key (default_area) references public.role_categories(key) on delete set null;

-- profiles.skills is an array, so a trigger checks it instead of a foreign key.
alter table public.profiles drop constraint if exists profiles_skills_check;
create or replace function public.profiles_validate_skills()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_bad text;
begin
  select s into v_bad from unnest(new.skills) s
   where not exists (select 1 from public.role_categories c where c.key = s) limit 1;
  if v_bad is not null then
    raise exception 'Unknown role category: %', v_bad using errcode = '23503';
  end if;
  new.skills := array(select distinct s from unnest(new.skills) s order by 1);
  return new;
end;
$$;
revoke all on function public.profiles_validate_skills() from public, anon, authenticated;
drop trigger if exists trg_profiles_validate_skills on public.profiles;
create trigger trg_profiles_validate_skills
  before insert or update of skills on public.profiles
  for each row execute function public.profiles_validate_skills();

-- Deleting a category takes it off everyone's skills.
create or replace function public.role_categories_on_delete()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles set skills = array_remove(skills, old.key) where old.key = any(skills);
  return old;
end;
$$;
revoke all on function public.role_categories_on_delete() from public, anon, authenticated;
drop trigger if exists trg_role_categories_on_delete on public.role_categories;
create trigger trg_role_categories_on_delete after delete on public.role_categories
  for each row execute function public.role_categories_on_delete();

-- ---------------------------------------------------------------------
-- 2. the project's person per category
-- ---------------------------------------------------------------------
create table if not exists public.project_area_developers (
  project_id   uuid not null references public.projects(id) on delete cascade,
  area         text not null references public.role_categories(key) on delete cascade,
  developer_id uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (project_id, area)
);
alter table public.project_area_developers enable row level security;
drop policy if exists project_area_developers_select on public.project_area_developers;
create policy project_area_developers_select on public.project_area_developers
  for select to authenticated using (public.can_see_project(project_id));
drop policy if exists project_area_developers_write on public.project_area_developers;
create policy project_area_developers_write on public.project_area_developers
  for all to authenticated using (public.is_qa_or_admin()) with check (public.is_qa_or_admin());

create or replace function public.project_area_developers_check()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_platform text; v_project_platform text;
begin
  if exists (select 1 from public.role_categories where key = new.area and all_platforms) then
    return new;  -- backend / DBA work spans every platform
  end if;
  v_platform := public.profile_platform(new.developer_id);
  select platform into v_project_platform from public.projects where id = new.project_id;
  if v_platform is not null and v_platform is distinct from v_project_platform then
    raise exception 'That developer works on % projects only; this project is %.',
      v_platform, coalesce(v_project_platform, 'not set to a platform') using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.project_area_developers_check() from public, anon, authenticated;
drop trigger if exists trg_project_area_developers_check on public.project_area_developers;
create trigger trg_project_area_developers_check
  before insert or update on public.project_area_developers
  for each row execute function public.project_area_developers_check();

-- Copy the 0041/0042 columns over, then drop them.
insert into public.project_area_developers (project_id, area, developer_id)
select id, a.area, a.dev from public.projects p
cross join lateral (values ('frontend', p.frontend_developer_id), ('backend', p.backend_developer_id),
                           ('database', p.database_developer_id), ('devops', p.devops_developer_id)) as a(area, dev)
where a.dev is not null
on conflict do nothing;

-- projects_check_developer (0035/0041/0042) goes back to the one column left.
create or replace function public.projects_check_developer()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_platform text;
begin
  if new.assigned_developer_id is not null
     and new.assigned_developer_id is distinct from old.assigned_developer_id then
    v_platform := public.profile_platform(new.assigned_developer_id);
    if v_platform is not null and v_platform is distinct from new.platform then
      raise exception 'That developer works on % projects only; this project is %.',
        v_platform, coalesce(new.platform, 'not set to a platform') using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.projects_check_developer() from public, anon, authenticated;

alter table public.projects
  drop column if exists frontend_developer_id,
  drop column if exists backend_developer_id,
  drop column if exists database_developer_id,
  drop column if exists devops_developer_id;

-- ---------------------------------------------------------------------
-- 3. auto-assignment
-- ---------------------------------------------------------------------
-- The least busy person in a category who can see the project, or NULL.
create or replace function public.least_busy_in_category(p_area text, p_project uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  select p.id
    from public.profiles p
    join public.roles r on r.key = p.role
    join public.projects pr on pr.id = p_project
    join public.role_categories c on c.key = p_area
   where p_area = any(p.skills)
     and r.assignable
     and r.level in ('admin', 'manager', 'contributor')
     and (c.all_platforms or r.platform is null or r.platform = pr.platform)
   order by
     (select count(*) from public.tasks t where t.assignee_id = p.id and t.status <> 'done')
   + (select count(*) from public.bugs b where b.assignee_id = p.id
        and b.status not in ('fixed', 'ready_for_retest', 'closed')),
     p.full_name, p.id
   limit 1
$$;
-- only the assignment triggers call it
revoke all on function public.least_busy_in_category(text, uuid) from public, anon, authenticated;

create or replace function public.bugs_default_assignee()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.assignee_id is null then
    if new.area is not null then
      select developer_id into new.assignee_id from public.project_area_developers
       where project_id = new.project_id and area = new.area;
      if new.assignee_id is null then
        new.assignee_id := public.least_busy_in_category(new.area, new.project_id);
      end if;
    end if;
    if new.assignee_id is null then
      select assigned_developer_id into new.assignee_id from public.projects where id = new.project_id;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.bugs_default_assignee() from public, anon, authenticated;

-- Sets (or clears, with NULL) a category's developer, and assigns that category's open,
-- unassigned bugs to them. p_area NULL = the developer for bugs with no category.
-- Runs as the caller: QA/admin only. Returns how many bugs were assigned.
create or replace function public.assign_project_developer(
  p_project uuid, p_developer uuid, p_area text default null)
returns integer language plpgsql security invoker set search_path = public
as $$
declare v_count integer := 0;
begin
  if not public.is_qa_or_admin() then
    raise exception 'Only QA or an admin can assign a project to a developer.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if p_area is not null and not exists (select 1 from public.role_categories where key = p_area) then
    raise exception 'Unknown role category: %', p_area using errcode = '22023';
  end if;

  if p_area is null then
    update public.projects set assigned_developer_id = p_developer where id = p_project;
  elsif p_developer is null then
    delete from public.project_area_developers where project_id = p_project and area = p_area;
  else
    insert into public.project_area_developers (project_id, area, developer_id)
    values (p_project, p_area, p_developer)
    on conflict (project_id, area) do update set developer_id = excluded.developer_id;
  end if;

  if p_developer is not null then
    update public.bugs set assignee_id = p_developer
     where project_id = p_project and assignee_id is null and status <> 'closed'
       and area is not distinct from p_area;
    get diagnostics v_count = row_count;
  end if;
  return v_count;
end;
$$;
grant execute on function public.assign_project_developer(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. tasks get a category, and are auto-assigned by it
-- ---------------------------------------------------------------------
alter table public.tasks add column if not exists area text
  references public.role_categories(key) on delete set null;
create index if not exists tasks_area_idx on public.tasks(area);

create or replace function public.tasks_default_assignee()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.assignee_id is null and new.area is not null then
    new.assignee_id := public.least_busy_in_category(new.area, new.project_id);
  end if;
  return new;
end;
$$;
revoke all on function public.tasks_default_assignee() from public, anon, authenticated;
drop trigger if exists trg_tasks_default_assignee on public.tasks;
create trigger trg_tasks_default_assignee
  before insert on public.tasks
  for each row execute function public.tasks_default_assignee();

create or replace function public.tasks_notify_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.assignee_id is not null
     and new.assignee_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000') then
    insert into public.notifications (user_id, type, message, related_task_id)
    values (new.assignee_id, 'assignment', 'You were assigned task: ' || new.title, new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.tasks_notify_insert() from public, anon, authenticated;
drop trigger if exists trg_tasks_notify_insert on public.tasks;
create trigger trg_tasks_notify_insert
  after insert on public.tasks
  for each row execute function public.tasks_notify_insert();

-- ---------------------------------------------------------------------
-- 5. people in an all-platforms category see every platform's projects
-- ---------------------------------------------------------------------
-- user_platform() (0034) is what every visibility policy checks; NULL = every platform.
-- profile_platform() (0035) stays the role's own platform: it decides who may be a
-- project's person for a platform-specific category.
create or replace function public.user_platform()
returns text language sql stable security definer set search_path = public
as $$ select case
           when exists (select 1 from public.role_categories c
                         where c.all_platforms and c.key = any(p.skills)) then null
           else r.platform
         end
      from public.profiles p join public.roles r on r.key = p.role
      where p.id = auth.uid() $$;
