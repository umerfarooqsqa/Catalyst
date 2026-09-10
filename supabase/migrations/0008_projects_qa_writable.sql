-- =====================================================================
-- 0008 — Let QA (not just Admin) create and rename projects.
-- Deleting a project stays Admin-only.
-- =====================================================================

drop policy if exists "projects_admin_write" on public.projects;
drop policy if exists "projects_qa_insert" on public.projects;
drop policy if exists "projects_qa_update" on public.projects;
drop policy if exists "projects_admin_delete" on public.projects;

create policy "projects_qa_insert" on public.projects
  for insert to authenticated with check (public.is_qa_or_admin());
create policy "projects_qa_update" on public.projects
  for update to authenticated
  using (public.is_qa_or_admin()) with check (public.is_qa_or_admin());
create policy "projects_admin_delete" on public.projects
  for delete to authenticated using (public.is_admin());
