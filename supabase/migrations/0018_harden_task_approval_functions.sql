-- =====================================================================
-- 0018 — Security-advisor hardening for the functions added in 0017,
-- following the same pattern as 0007_harden_functions.sql.
-- =====================================================================

-- Trigger-only function: never meant to be invoked directly.
revoke all on function public.tasks_enforce_approval() from public, anon, authenticated;

-- RLS helper: callable by signed-in users, not anon (matches is_admin/is_qa_or_admin/is_staff).
revoke all on function public.is_viewer() from public, anon;
grant execute on function public.is_viewer() to authenticated;
