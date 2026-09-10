-- =====================================================================
-- 0009 — Run the SLA-breach sweep on a schedule instead of on every
-- page load. Previously `sweep_sla_breaches()` was called from the
-- dashboard / my-queue / bugs Server Components, adding a full `bugs`
-- scan + insert (~500 ms) to those requests.
-- =====================================================================

create extension if not exists pg_cron;

-- No client calls this any more — cron (postgres) runs it.
revoke all on function public.sweep_sla_breaches() from public, anon, authenticated;

-- Every 10 minutes. `sweep_sla_breaches()` is idempotent (it skips bugs
-- that already have an sla_breach notification).
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'catalyst-sla-sweep') then
    perform cron.schedule(
      'catalyst-sla-sweep',
      '*/10 * * * *',
      $job$ select public.sweep_sla_breaches() $job$
    );
  end if;
end $$;
