-- =====================================================================
-- 0007 — Security-advisor hardening for DB functions
--   * pin search_path on the 3 remaining mutable-search_path functions
--   * stop trigger functions being callable as PostgREST RPC
--   * keep the RLS helper functions callable by signed-in users only
-- =====================================================================

alter function public.handle_new_user() set search_path = public;
alter function public.touch_updated_at() set search_path = public;
alter function public.tasks_touch_completed() set search_path = public;

-- Trigger-only functions: never meant to be invoked directly.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.tasks_touch_completed() from public, anon, authenticated;
revoke all on function public.bugs_set_sla_deadline() from public, anon, authenticated;
revoke all on function public.bugs_notify() from public, anon, authenticated;
revoke all on function public.tasks_notify() from public, anon, authenticated;
revoke all on function public.comments_notify() from public, anon, authenticated;

-- RLS helpers + the SLA sweep: callable by signed-in users, not anon.
revoke all on function public.current_user_role() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_qa_or_admin() from public, anon;
revoke all on function public.is_staff() from public, anon;
revoke all on function public.sweep_sla_breaches() from public, anon;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_qa_or_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.sweep_sla_breaches() to authenticated;
