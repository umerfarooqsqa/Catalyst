-- =====================================================================
-- 0034 — Platform visibility, developer rights on bugs, better comments.
--
-- 1. A role can be tied to a platform (roles.platform). The seeded
--    'android' and 'ios' developer roles get theirs. A user whose role has
--    a platform sees ONLY that platform's projects, and everything inside
--    them: bugs, releases, tasks, requirements, attachments, comments, runs,
--    automation jobs, and the Bug Library entries of that platform.
--    Roles without a platform (admin, QA, backoffice, viewer) are unchanged.
--    Projects with no platform set are hidden from platform-bound users.
--
-- 2. Developers (contributor level) may move a bug they can see to
--    'in_progress' or 'fixed', and change nothing else. They cannot close,
--    edit, delete, assign or re-version it, and they can't touch a closed
--    bug. Managers/admins are unchanged. Enforced by the bugs_update policy
--    plus a BEFORE UPDATE trigger (RLS cannot restrict columns). The service
--    role (automation API) is not affected.
--
-- 3. Comments: edited_at (set when the author edits the text; nothing else
--    may change), the insert rule also checks the commenter can see the bug,
--    and comments are published to realtime so open drawers update live.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. roles.platform + helpers
-- ---------------------------------------------------------------------
alter table public.roles add column if not exists platform text
  check (platform in ('android', 'ios'));
update public.roles set platform = 'android' where key = 'android';
update public.roles set platform = 'ios'     where key = 'ios';

-- The platform the current user is limited to, or NULL = every platform.
create or replace function public.user_platform()
returns text language sql stable security definer set search_path = public
as $$ select r.platform from public.profiles p join public.roles r on r.key = p.role
      where p.id = auth.uid() $$;

-- May the current user see this project? (SECURITY DEFINER: no RLS recursion on projects.)
create or replace function public.can_see_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select public.user_platform() is null
          or exists (select 1 from public.projects pr
                      where pr.id = p_project and pr.platform = public.user_platform()) $$;

create or replace function public.can_see_bug(p_bug uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select public.user_platform() is null
          or exists (select 1 from public.bugs b join public.projects pr on pr.id = b.project_id
                      where b.id = p_bug and pr.platform = public.user_platform()) $$;

create or replace function public.can_see_task(p_task uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select public.user_platform() is null
          or exists (select 1 from public.tasks t join public.projects pr on pr.id = t.project_id
                      where t.id = p_task and pr.platform = public.user_platform()) $$;

grant execute on function public.user_platform() to authenticated;
grant execute on function public.can_see_project(uuid) to authenticated;
grant execute on function public.can_see_bug(uuid) to authenticated;
grant execute on function public.can_see_task(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 1b. Select policies: same as before, AND the platform rule.
-- ---------------------------------------------------------------------
drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects
  for select to authenticated
  using (public.user_platform() is null or platform = public.user_platform());

drop policy if exists "project_members_select" on public.project_members;
create policy "project_members_select" on public.project_members
  for select to authenticated using (public.can_see_project(project_id));

drop policy if exists "bugs_select" on public.bugs;
create policy "bugs_select" on public.bugs
  for select to authenticated using (public.can_see_project(project_id));

drop policy if exists "releases_select" on public.releases;
create policy "releases_select" on public.releases
  for select to authenticated using (public.can_see_project(project_id));

drop policy if exists "automation_runs_select" on public.automation_runs;
create policy "automation_runs_select" on public.automation_runs
  for select to authenticated
  using (exists (select 1 from public.releases r
                  where r.id = release_id and public.can_see_project(r.project_id)));

drop policy if exists "test_jobs_select" on public.test_jobs;
create policy "test_jobs_select" on public.test_jobs
  for select to authenticated using (public.can_see_project(project_id));

drop policy if exists "requirements_select" on public.requirements;
create policy "requirements_select" on public.requirements
  for select to authenticated using (public.can_see_project(project_id));

drop policy if exists "test_cases_select" on public.test_cases;
create policy "test_cases_select" on public.test_cases
  for select to authenticated
  using (exists (select 1 from public.requirements r
                  where r.id = requirement_id and public.can_see_project(r.project_id)));

drop policy if exists project_automation_select on public.project_automation;
create policy project_automation_select on public.project_automation
  for select to authenticated using (public.can_see_project(project_id));

drop policy if exists "requirement_documents_select" on public.requirement_documents;
create policy "requirement_documents_select" on public.requirement_documents
  for select to authenticated using (public.can_see_project(project_id));

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
    )
  );

-- Bug Library: a platform-bound user sees their platform's entries (and
-- client requirements of projects they can see).
drop policy if exists "base_page_select" on public.base_page;
create policy "base_page_select" on public.base_page
  for select to authenticated
  using (
    public.user_platform() is null
    or (source_type = 'master_bug' and platform = public.user_platform())
    or (project_id is not null and public.can_see_project(project_id))
  );

drop policy if exists "attachments_select" on public.attachments;
create policy "attachments_select" on public.attachments
  for select to authenticated
  using (
    (bug_id is not null and public.can_see_bug(bug_id))
    or (task_id is not null and public.can_see_task(task_id))
  );

drop policy if exists "comments_select" on public.comments;
create policy "comments_select" on public.comments
  for select to authenticated
  using (
    (bug_id is not null and public.can_see_bug(bug_id))
    or (task_id is not null and public.can_see_task(task_id))
  );

-- Attachment files: objects are stored as "<bug or task id>/<file>".
drop policy if exists "attachments_read" on storage.objects;
create policy "attachments_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (
      public.user_platform() is null
      or exists (
        select 1 from public.attachments a
         where a.file_path = storage.objects.name
           and ((a.bug_id is not null and public.can_see_bug(a.bug_id))
                or (a.task_id is not null and public.can_see_task(a.task_id)))
      )
    )
  );

-- ---------------------------------------------------------------------
-- 2. Developer rights on bugs
-- ---------------------------------------------------------------------
drop policy if exists "bugs_update" on public.bugs;
create policy "bugs_update" on public.bugs
  for update to authenticated
  using (public.is_qa_or_admin() or (public.is_staff() and public.can_see_project(project_id)))
  with check (public.is_qa_or_admin() or (public.is_staff() and public.can_see_project(project_id)));

create or replace function public.bugs_enforce_developer_rights()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  -- columns other triggers maintain, which a status change may move
  v_auto text[] := array['status', 'updated_at', 'closed_at'];
begin
  if auth.uid() is null or public.is_qa_or_admin() then
    return new;  -- service role (automation API), QA, backoffice, admin
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

drop trigger if exists trg_bugs_developer_rights on public.bugs;
create trigger trg_bugs_developer_rights
  before update on public.bugs
  for each row execute function public.bugs_enforce_developer_rights();

-- ---------------------------------------------------------------------
-- 3. Comments
-- ---------------------------------------------------------------------
alter table public.comments add column if not exists edited_at timestamptz;

create or replace function public.comments_on_edit()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.bug_id is distinct from old.bug_id or new.task_id is distinct from old.task_id
     or new.author_id is distinct from old.author_id or new.created_at is distinct from old.created_at then
    raise exception 'Only a comment''s text can be edited.' using errcode = '42501';
  end if;
  if new.content is distinct from old.content then
    new.edited_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.comments_on_edit() from public, anon, authenticated;

drop trigger if exists trg_comments_on_edit on public.comments;
create trigger trg_comments_on_edit
  before update on public.comments
  for each row execute function public.comments_on_edit();

drop policy if exists "comments_staff_insert" on public.comments;
create policy "comments_staff_insert" on public.comments
  for insert to authenticated
  with check (
    public.is_staff() and author_id = auth.uid()
    and ((bug_id is not null and public.can_see_bug(bug_id))
         or (task_id is not null and public.can_see_task(task_id)))
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments') then
    alter publication supabase_realtime add table public.comments;
  end if;
end $$;
