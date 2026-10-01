-- =====================================================================
-- 0035: a developer per project ("assign the whole project to a developer").
--
-- projects.assigned_developer_id: the developer who owns the project's bugs.
--   - Assigning them (assign_project_developer) also assigns every open,
--     unassigned bug of the project to them. Bugs already assigned to
--     someone keep their assignee.
--   - Every new bug logged in the project with no assignee is auto-assigned
--     to them (trg_bugs_default_assignee). That covers bugs from the UI, the
--     Bug Library and automation.
--   - The developer must be able to see the project: their role's platform
--     is none, or the project's platform (migration 0034).
-- Only QA/admin can set it: the projects update RLS is is_qa_or_admin().
-- =====================================================================

alter table public.projects
  add column if not exists assigned_developer_id uuid references public.profiles(id) on delete set null;

create or replace function public.profile_platform(p_user uuid)
returns text language sql stable security definer set search_path = public
as $$ select r.platform from public.profiles p join public.roles r on r.key = p.role where p.id = p_user $$;
grant execute on function public.profile_platform(uuid) to authenticated;

-- A developer who couldn't see the project can't own it.
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
drop trigger if exists trg_projects_check_developer on public.projects;
create trigger trg_projects_check_developer
  before update on public.projects
  for each row execute function public.projects_check_developer();

-- New bugs with no assignee go to the project's developer.
create or replace function public.bugs_default_assignee()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.assignee_id is null then
    select assigned_developer_id into new.assignee_id from public.projects where id = new.project_id;
  end if;
  return new;
end;
$$;
revoke all on function public.bugs_default_assignee() from public, anon, authenticated;
drop trigger if exists trg_bugs_default_assignee on public.bugs;
create trigger trg_bugs_default_assignee
  before insert on public.bugs
  for each row execute function public.bugs_default_assignee();

-- Sets (or clears, with NULL) the project's developer and assigns the open,
-- unassigned bugs to them. Runs as the caller, so RLS decides who may:
-- QA/admin only. Returns how many bugs were assigned.
create or replace function public.assign_project_developer(p_project uuid, p_developer uuid)
returns integer language plpgsql security invoker set search_path = public
as $$
declare v_count integer := 0;
begin
  if not public.is_qa_or_admin() then
    raise exception 'Only QA or an admin can assign a project to a developer.' using errcode = '42501';
  end if;
  update public.projects set assigned_developer_id = p_developer where id = p_project;
  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if p_developer is not null then
    update public.bugs set assignee_id = p_developer
     where project_id = p_project and assignee_id is null and status <> 'closed';
    get diagnostics v_count = row_count;
  end if;
  return v_count;
end;
$$;
grant execute on function public.assign_project_developer(uuid, uuid) to authenticated;
