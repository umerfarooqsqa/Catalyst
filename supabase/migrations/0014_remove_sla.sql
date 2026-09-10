-- =====================================================================
-- 0014 — Remove the SLA subsystem.
-- Drops sla_settings, bugs.sla_deadline, the deadline trigger, the
-- breach-sweep function and its pg_cron job. The closed_at bookkeeping
-- that used to ride along in bugs_set_sla_deadline() is preserved in a
-- new closed-only trigger. The `notification_type` enum keeps its
-- `sla_breach` value (Postgres can't drop enum values cleanly) but
-- nothing writes it any more; existing rows are deleted.
-- =====================================================================

-- 1. Stop and drop the cron sweep.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'catalyst-sla-sweep') then
    perform cron.unschedule('catalyst-sla-sweep');
  end if;
end $$;

drop function if exists public.sweep_sla_breaches();

-- 2. Replace the SLA-deadline trigger with a closed_at-only one.
drop trigger if exists trg_bugs_sla on public.bugs;
drop function if exists public.bugs_set_sla_deadline();

create or replace function public.bugs_touch_closed()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'closed'
     and (tg_op = 'INSERT' or old.status is distinct from 'closed') then
    new.closed_at := now();
  elsif new.status <> 'closed' then
    new.closed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.bugs_touch_closed() from public, anon, authenticated;

drop trigger if exists trg_bugs_closed on public.bugs;
create trigger trg_bugs_closed
  before insert or update on public.bugs
  for each row execute function public.bugs_touch_closed();

-- 3. Drop SLA data.
delete from public.notifications where type = 'sla_breach';
alter table public.bugs drop column if exists sla_deadline;
drop table if exists public.sla_settings;
