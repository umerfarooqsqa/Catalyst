-- =====================================================================
-- 0037: QA writes each app's versions, and confirms which bugs belong to one.
--
-- 1. releases_qa_insert: QA/admin may add a version (a `releases` row) to a
--    project they can see, from the Bugs page's "App versions" panel. Until now
--    only the service role wrote releases (release notes, automation).
-- 2. bugs.version_confirmed_at / version_confirmed_by: after filing bugs under a
--    version, QA confirms they really belong to it. The trigger below:
--    - takes the time and the confirming user from the session, never from the
--      client;
--    - clears the confirmation whenever the bug's version changes (a
--      confirmation is for one version only), including automation re-pointing
--      an automation bug to a later release;
--    - refuses to confirm a bug that has no version.
--    Developers already cannot change either column: 0034's
--    trg_bugs_developer_rights only lets them change status.
-- =====================================================================

drop policy if exists "releases_qa_insert" on public.releases;
create policy "releases_qa_insert" on public.releases
  for insert to authenticated
  with check (public.is_qa_or_admin() and public.can_see_project(project_id));

alter table public.bugs
  add column if not exists version_confirmed_at timestamptz,
  add column if not exists version_confirmed_by uuid references public.profiles(id) on delete set null;

create or replace function public.bugs_version_confirmation()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_was timestamptz := case when tg_op = 'UPDATE' then old.version_confirmed_at end;
begin
  if tg_op = 'UPDATE' and new.release_id is distinct from old.release_id then
    new.version_confirmed_at := null;
    new.version_confirmed_by := null;
    return new;
  end if;
  if new.version_confirmed_at is null then
    new.version_confirmed_by := null;
    return new;
  end if;
  if new.release_id is null then
    raise exception 'A bug with no app version cannot be confirmed. Set its version first.'
      using errcode = '23514';
  end if;
  if v_was is null then  -- being confirmed now
    new.version_confirmed_at := now();
    new.version_confirmed_by := auth.uid();  -- null for the service role
  else                   -- already confirmed: keep who and when
    new.version_confirmed_at := v_was;
    new.version_confirmed_by := old.version_confirmed_by;
  end if;
  return new;
end;
$$;
revoke all on function public.bugs_version_confirmation() from public, anon, authenticated;

drop trigger if exists trg_bugs_version_confirmation on public.bugs;
create trigger trg_bugs_version_confirmation
  before insert or update on public.bugs
  for each row execute function public.bugs_version_confirmation();
