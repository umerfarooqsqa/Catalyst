-- Generic Bugs (2026-11-10, decided with the user): Bug Library entries with
-- base_page.platform NULL (the tab formerly called "Unassigned") are bugs that
-- apply to Android and iOS alike. 0034's base_page_select showed a
-- platform-bound user only their own platform's entries, so Android/iOS
-- developers couldn't see them. They now can. Tradecast-bound users (0064)
-- still don't: Generic Bugs belong to the main Android/iOS library.
-- Everything else is 0034's policy unchanged.
drop policy if exists "base_page_select" on public.base_page;
create policy "base_page_select" on public.base_page
  for select to authenticated
  using (
    public.user_platform() is null
    or (source_type = 'master_bug' and platform = public.user_platform())
    or (source_type = 'master_bug' and platform is null and public.user_platform() in ('android', 'ios'))
    or (project_id is not null and public.can_see_project(project_id))
  );
