-- =====================================================================
-- 0010 — Allow the anon role to read bug_categories.
-- They are non-sensitive templates (default severity, steps skeleton,
-- keyword hints). This lets the app serve them from Next's cross-request
-- Data Cache (unstable_cache) with a plain anon client, instead of a
-- cookie-scoped fetch on every bugs / master-library / admin page load.
-- =====================================================================

drop policy if exists "bug_categories_select" on public.bug_categories;
create policy "bug_categories_select" on public.bug_categories
  for select to anon, authenticated using (true);
