-- =====================================================================
-- 0041: frontend / backend bugs.
--
-- 1. bugs.area / base_page.area: 'frontend' (the app UI: screens, layout,
--    navigation) or 'backend' (the trading server/API: wrong data, failed
--    orders, feed, login service). NULL = not set yet. QA/admin set it;
--    developers can't (0040's developer-rights trigger already refuses any
--    column but status), and automation sends its guess from the test.
--    The portal suggests it from the bug's text (lib/bug-area.ts).
--
-- 2. bug_categories.default_area: the area a category usually means, used by
--    the suggestion. Seeded for the built-in categories; NULL = either.
--
-- 3. A developer per area: projects.frontend_developer_id and
--    backend_developer_id. projects.assigned_developer_id (0035) stays the
--    developer for bugs whose area isn't set, and the fallback when an area
--    has no developer. Both new columns start as a copy of it, so routing
--    doesn't change until QA picks someone.
--    - New bugs with no assignee go to their area's developer
--      (trg_bugs_default_assignee, replaced).
--    - assign_project_developer gains p_area: it sets that area's developer
--      and assigns that area's open, unassigned bugs.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. area columns
-- ---------------------------------------------------------------------
alter table public.bugs add column if not exists area text
  check (area in ('frontend', 'backend'));
create index if not exists bugs_area_idx on public.bugs(area);

alter table public.base_page add column if not exists area text
  check (area in ('frontend', 'backend'));

-- ---------------------------------------------------------------------
-- 2. category default
-- ---------------------------------------------------------------------
alter table public.bug_categories add column if not exists default_area text
  check (default_area in ('frontend', 'backend'));

update public.bug_categories set default_area = 'frontend'
 where default_area is null and name in ('UI / Layout', 'Content / Copy', 'Crash / Error');
update public.bug_categories set default_area = 'backend'
 where default_area is null and name in ('Data / Sync', 'Payment / Billing');

-- ---------------------------------------------------------------------
-- 3. a developer per area
-- ---------------------------------------------------------------------
alter table public.projects
  add column if not exists frontend_developer_id uuid references public.profiles(id) on delete set null,
  add column if not exists backend_developer_id  uuid references public.profiles(id) on delete set null;

update public.projects
   set frontend_developer_id = coalesce(frontend_developer_id, assigned_developer_id),
       backend_developer_id  = coalesce(backend_developer_id,  assigned_developer_id)
 where assigned_developer_id is not null;

-- A developer who couldn't see the project can't own any part of it (0035, now for all three).
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
    case when new.backend_developer_id  is distinct from old.backend_developer_id  then new.backend_developer_id  end
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

-- New bugs with no assignee go to their area's developer, else the project's developer.
create or replace function public.bugs_default_assignee()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.assignee_id is null then
    select coalesce(
             case new.area when 'frontend' then p.frontend_developer_id
                           when 'backend'  then p.backend_developer_id end,
             p.assigned_developer_id)
      into new.assignee_id
      from public.projects p where p.id = new.project_id;
  end if;
  return new;
end;
$$;
revoke all on function public.bugs_default_assignee() from public, anon, authenticated;

-- Sets (or clears, with NULL) one area's developer and assigns that area's
-- open, unassigned bugs to them. p_area NULL = the developer for bugs whose
-- area isn't set (projects.assigned_developer_id). Runs as the caller, so RLS
-- decides who may: QA/admin only. Returns how many bugs were assigned.
drop function if exists public.assign_project_developer(uuid, uuid);
create or replace function public.assign_project_developer(
  p_project uuid, p_developer uuid, p_area text default null)
returns integer language plpgsql security invoker set search_path = public
as $$
declare v_count integer := 0;
begin
  if not public.is_qa_or_admin() then
    raise exception 'Only QA or an admin can assign a project to a developer.' using errcode = '42501';
  end if;
  if p_area is not null and p_area not in ('frontend', 'backend') then
    raise exception 'Area must be frontend, backend or empty.' using errcode = '22023';
  end if;

  if p_area = 'frontend' then
    update public.projects set frontend_developer_id = p_developer where id = p_project;
  elsif p_area = 'backend' then
    update public.projects set backend_developer_id = p_developer where id = p_project;
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
