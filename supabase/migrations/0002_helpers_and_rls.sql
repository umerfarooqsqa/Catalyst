-- =====================================================================
-- 0002 — Role helper functions + full role-based RLS policy set
-- Reviewed as a whole against the roles table in CLAUDE.md.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper functions. SECURITY DEFINER so they can read profiles without
-- tripping the profiles RLS policies (which call them) — no recursion.
-- ---------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false) $$;

create or replace function public.is_qa_or_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select role in ('admin','qa') from public.profiles where id = auth.uid()), false) $$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select role in ('admin','qa','dev_app','dev_web') from public.profiles where id = auth.uid()), false) $$;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_qa_or_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;

-- ---------------------------------------------------------------------
-- PROFILES
-- ---------------------------------------------------------------------
drop policy if exists "Authenticated users can view profiles" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;
drop policy if exists "profiles_admin_all" on public.profiles;

create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

create policy "profiles_update_self" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "profiles_admin_all" on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- PROJECTS  (everyone reads; admin writes)
-- ---------------------------------------------------------------------
drop policy if exists "projects_select" on public.projects;
drop policy if exists "projects_admin_write" on public.projects;

create policy "projects_select" on public.projects
  for select to authenticated using (true);
create policy "projects_admin_write" on public.projects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- PROJECT_MEMBERS  (everyone reads; admin writes)
-- ---------------------------------------------------------------------
drop policy if exists "project_members_select" on public.project_members;
drop policy if exists "project_members_admin_write" on public.project_members;

create policy "project_members_select" on public.project_members
  for select to authenticated using (true);
create policy "project_members_admin_write" on public.project_members
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- REQUIREMENTS + TEST_CASES  (everyone reads; qa/admin write)
-- ---------------------------------------------------------------------
drop policy if exists "requirements_select" on public.requirements;
drop policy if exists "requirements_qa_write" on public.requirements;
create policy "requirements_select" on public.requirements
  for select to authenticated using (true);
create policy "requirements_qa_write" on public.requirements
  for all to authenticated using (public.is_qa_or_admin()) with check (public.is_qa_or_admin());

drop policy if exists "test_cases_select" on public.test_cases;
drop policy if exists "test_cases_qa_write" on public.test_cases;
create policy "test_cases_select" on public.test_cases
  for select to authenticated using (true);
create policy "test_cases_qa_write" on public.test_cases
  for all to authenticated using (public.is_qa_or_admin()) with check (public.is_qa_or_admin());

-- ---------------------------------------------------------------------
-- BUG_CATEGORIES  (everyone reads; admin writes)
-- ---------------------------------------------------------------------
drop policy if exists "bug_categories_select" on public.bug_categories;
drop policy if exists "bug_categories_admin_write" on public.bug_categories;
create policy "bug_categories_select" on public.bug_categories
  for select to authenticated using (true);
create policy "bug_categories_admin_write" on public.bug_categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- MASTER_BUGS  (everyone reads; qa/admin insert+update; admin delete)
-- ---------------------------------------------------------------------
drop policy if exists "master_bugs_select" on public.master_bugs;
drop policy if exists "master_bugs_qa_insert" on public.master_bugs;
drop policy if exists "master_bugs_qa_update" on public.master_bugs;
drop policy if exists "master_bugs_admin_delete" on public.master_bugs;
create policy "master_bugs_select" on public.master_bugs
  for select to authenticated using (true);
create policy "master_bugs_qa_insert" on public.master_bugs
  for insert to authenticated with check (public.is_qa_or_admin());
create policy "master_bugs_qa_update" on public.master_bugs
  for update to authenticated using (public.is_qa_or_admin()) with check (public.is_qa_or_admin());
create policy "master_bugs_admin_delete" on public.master_bugs
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- BUGS
--   select : any authenticated
--   insert : qa / admin
--   update : qa / admin, OR a dev who is the assignee
--   delete : qa / admin
-- ---------------------------------------------------------------------
drop policy if exists "bugs_select" on public.bugs;
drop policy if exists "bugs_qa_insert" on public.bugs;
drop policy if exists "bugs_update" on public.bugs;
drop policy if exists "bugs_qa_delete" on public.bugs;
create policy "bugs_select" on public.bugs
  for select to authenticated using (true);
create policy "bugs_qa_insert" on public.bugs
  for insert to authenticated with check (public.is_qa_or_admin());
create policy "bugs_update" on public.bugs
  for update to authenticated
  using (public.is_qa_or_admin() or assignee_id = auth.uid())
  with check (public.is_qa_or_admin() or assignee_id = auth.uid());
create policy "bugs_qa_delete" on public.bugs
  for delete to authenticated using (public.is_qa_or_admin());

-- ---------------------------------------------------------------------
-- TASKS
--   select : any authenticated
--   insert : qa / admin
--   update : qa / admin, OR the assignee, OR the creator
--   delete : qa / admin
-- ---------------------------------------------------------------------
drop policy if exists "tasks_select" on public.tasks;
drop policy if exists "tasks_qa_insert" on public.tasks;
drop policy if exists "tasks_update" on public.tasks;
drop policy if exists "tasks_qa_delete" on public.tasks;
create policy "tasks_select" on public.tasks
  for select to authenticated using (true);
create policy "tasks_qa_insert" on public.tasks
  for insert to authenticated with check (public.is_qa_or_admin());
create policy "tasks_update" on public.tasks
  for update to authenticated
  using (public.is_qa_or_admin() or assignee_id = auth.uid() or created_by = auth.uid())
  with check (public.is_qa_or_admin() or assignee_id = auth.uid() or created_by = auth.uid());
create policy "tasks_qa_delete" on public.tasks
  for delete to authenticated using (public.is_qa_or_admin());

-- ---------------------------------------------------------------------
-- ATTACHMENTS  (everyone reads; staff upload as themselves; uploader/admin delete)
-- ---------------------------------------------------------------------
drop policy if exists "attachments_select" on public.attachments;
drop policy if exists "attachments_staff_insert" on public.attachments;
drop policy if exists "attachments_delete" on public.attachments;
create policy "attachments_select" on public.attachments
  for select to authenticated using (true);
create policy "attachments_staff_insert" on public.attachments
  for insert to authenticated with check (public.is_staff() and uploaded_by = auth.uid());
create policy "attachments_delete" on public.attachments
  for delete to authenticated using (uploaded_by = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- COMMENTS  (everyone reads; staff comment as themselves; author/admin edit+delete)
-- ---------------------------------------------------------------------
drop policy if exists "comments_select" on public.comments;
drop policy if exists "comments_staff_insert" on public.comments;
drop policy if exists "comments_author_update" on public.comments;
drop policy if exists "comments_author_delete" on public.comments;
create policy "comments_select" on public.comments
  for select to authenticated using (true);
create policy "comments_staff_insert" on public.comments
  for insert to authenticated with check (public.is_staff() and author_id = auth.uid());
create policy "comments_author_update" on public.comments
  for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "comments_author_delete" on public.comments
  for delete to authenticated using (author_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- NOTIFICATIONS  (recipient-only read/update/delete; inserts come from
-- SECURITY DEFINER triggers, plus authenticated staff for app-side sends)
-- ---------------------------------------------------------------------
drop policy if exists "notifications_own_select" on public.notifications;
drop policy if exists "notifications_own_update" on public.notifications;
drop policy if exists "notifications_own_delete" on public.notifications;
drop policy if exists "notifications_staff_insert" on public.notifications;
create policy "notifications_own_select" on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy "notifications_own_update" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notifications_own_delete" on public.notifications
  for delete to authenticated using (user_id = auth.uid());
create policy "notifications_staff_insert" on public.notifications
  for insert to authenticated with check (public.is_staff());

-- ---------------------------------------------------------------------
-- SLA_SETTINGS  (everyone reads; admin writes)
-- ---------------------------------------------------------------------
drop policy if exists "sla_settings_select" on public.sla_settings;
drop policy if exists "sla_settings_admin_write" on public.sla_settings;
create policy "sla_settings_select" on public.sla_settings
  for select to authenticated using (true);
create policy "sla_settings_admin_write" on public.sla_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
