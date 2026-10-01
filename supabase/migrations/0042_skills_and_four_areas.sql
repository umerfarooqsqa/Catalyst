-- =====================================================================
-- 0042: developer skills, and four bug areas.
--
-- 1. profiles.skills: any combination of 'frontend', 'backend', 'database'
--    (DBA) and 'devops'. Set by an admin on Admin -> Users; one person can
--    have several. The portal uses them to offer the right people for an
--    area (the project's area developer pickers, a bug's assignee list).
--    Only an admin may change them (same trigger as role and dev_rank, 0040).
--
-- 2. A bug's area (0041) can also be 'database' or 'devops', on bugs,
--    base_page and bug_categories.default_area.
--
-- 3. A developer per area for the two new areas:
--    projects.database_developer_id / devops_developer_id, with the same
--    platform check, default routing and assign_project_developer support as
--    frontend/backend (0041). They start empty: bugs of those areas go to the
--    project's no-area developer until QA picks someone.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. skills
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists skills text[] not null default '{}'
  check (skills <@ array['frontend', 'backend', 'database', 'devops']::text[]);

create or replace function public.profiles_protect_admin_fields()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and (new.role is distinct from old.role
          or new.dev_rank is distinct from old.dev_rank
          or new.skills is distinct from old.skills) then
    raise exception 'Only an admin can change a user''s role, developer rank or skills.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_protect_admin_fields() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. four areas
-- ---------------------------------------------------------------------
alter table public.bugs drop constraint if exists bugs_area_check;
alter table public.bugs add constraint bugs_area_check
  check (area in ('frontend', 'backend', 'database', 'devops'));

alter table public.base_page drop constraint if exists base_page_area_check;
alter table public.base_page add constraint base_page_area_check
  check (area in ('frontend', 'backend', 'database', 'devops'));

alter table public.bug_categories drop constraint if exists bug_categories_default_area_check;
alter table public.bug_categories add constraint bug_categories_default_area_check
  check (default_area in ('frontend', 'backend', 'database', 'devops'));

-- ---------------------------------------------------------------------
-- 3. a developer for each new area
-- ---------------------------------------------------------------------
alter table public.projects
  add column if not exists database_developer_id uuid references public.profiles(id) on delete set null,
  add column if not exists devops_developer_id   uuid references public.profiles(id) on delete set null;

create or replace function public.projects_check_developer()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_dev uuid;
  v_platform text;
begin
  foreach v_dev in array array[
    case when new.assigned_developer_id is distinct from old.assigned_developer_id then new.assigned_developer_id end,
    case when new.frontend_developer_id is distinct from old.frontend_developer_id then new.frontend_developer_id end,
    case when new.backend_developer_id  is distinct from old.backend_developer_id  then new.backend_developer_id  end,
    case when new.database_developer_id is distinct from old.database_developer_id then new.database_developer_id end,
    case when new.devops_developer_id   is distinct from old.devops_developer_id   then new.devops_developer_id   end
  ] loop
    if v_dev is not null then
      v_platform := public.profile_platform(v_dev);
      if v_platform is not null and v_platform is distinct from new.platform then
        raise exception 'That developer works on % projects only; this project is %.',
          v_platform, coalesce(new.platform, 'not set to a platform') using errcode = '22023';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.projects_check_developer() from public, anon, authenticated;

create or replace function public.bugs_default_assignee()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.assignee_id is null then
    select coalesce(
             case new.area when 'frontend' then p.frontend_developer_id
                           when 'backend'  then p.backend_developer_id
                           when 'database' then p.database_developer_id
                           when 'devops'   then p.devops_developer_id end,
             p.assigned_developer_id)
      into new.assignee_id
      from public.projects p where p.id = new.project_id;
  end if;
  return new;
end;
$$;
revoke all on function public.bugs_default_assignee() from public, anon, authenticated;

create or replace function public.assign_project_developer(
  p_project uuid, p_developer uuid, p_area text default null)
returns integer language plpgsql security invoker set search_path = public
as $$
declare v_count integer := 0;
begin
  if not public.is_qa_or_admin() then
    raise exception 'Only QA or an admin can assign a project to a developer.' using errcode = '42501';
  end if;
  if p_area is not null and p_area not in ('frontend', 'backend', 'database', 'devops') then
    raise exception 'Area must be frontend, backend, database, devops or empty.' using errcode = '22023';
  end if;

  if p_area = 'frontend' then
    update public.projects set frontend_developer_id = p_developer where id = p_project;
  elsif p_area = 'backend' then
    update public.projects set backend_developer_id = p_developer where id = p_project;
  elsif p_area = 'database' then
    update public.projects set database_developer_id = p_developer where id = p_project;
  elsif p_area = 'devops' then
    update public.projects set devops_developer_id = p_developer where id = p_project;
  else
    update public.projects set assigned_developer_id = p_developer where id = p_project;
  end if;
  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
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
