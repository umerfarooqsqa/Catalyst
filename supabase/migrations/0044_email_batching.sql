-- =====================================================================
-- 0044: bug emails with an outbox, a daily quota and auto-batching.
--
-- Decided with the user (2026-10-02):
--   * Per-project mode: 'instant' (one email per event), 'auto_batch' (the
--     default: one email once a person has N pending bugs, N per project,
--     default 5) or 'daily_digest' (one summary a day at the project's time).
--   * One person's pending bugs are grouped across projects into ONE email.
--     The batch goes out when the SMALLEST N among the auto-batch projects they
--     have pending bugs in is reached. Digest bugs wait for their digest, but
--     ride along when a batch goes out first.
--   * Critical bugs skip batching. Pending bugs older than the project's
--     fallback (default 4 hours) are sent even below N.
--   * The same bug changing several times while pending is one row, and the
--     email shows the bug as it is when the email is built (latest status).
--   * Quota: every email counts 1 (a batch too) toward a daily limit (default
--     300, private.settings 'email_daily_limit'), per day in Asia/Karachi
--     ('email_timezone'). When the quota is used up, batches are NOT built:
--     pending bugs keep collecting and go out as one email after the reset.
--     Critical/instant emails still enter the outbox and wait there, critical
--     first.
--
-- Where it hooks in: every row inserted into public.notifications that is
-- about a bug (assignment, status_change, comment, retest_ready) is offered to
-- email_enqueue() for that user. So the email recipients are exactly the bell's
-- recipients, minus anyone who opted out (email_opt_outs), and this keeps
-- working whenever bugs_notify() is replaced again. New: bugs_notify_insert()
-- pings the assignee of a bug that is created already assigned (it notified
-- nobody before; tasks got the same fix in 0043).
--
-- Sending: an insert into email_outbox pings the app (pg_net, like push in
-- 0016) at private.settings 'email_dispatch_url'. The app claims rows with
-- email_claim() (quota-checked, one claimer at a time) and reports each with
-- email_mark(). The ping carries no data: the endpoint only sends what is
-- already queued, so it needs no secret. A pg_cron sweep every 5 minutes
-- flushes the time fallback and digests and re-pings for waiting emails.
--
-- No duplicates: building a batch deletes the person's pending rows
-- (DELETE ... RETURNING) and inserts the email in the same transaction. The
-- decision to flush takes pg_try_advisory_xact_lock on the recipient; a
-- transaction that can't get it never waits (no deadlocks) and leaves its row
-- for the next event or the sweep.
--
-- Time for tests: email_now() is now() unless the transaction sets
-- catalyst.email_now (set local catalyst.email_now = '...').
-- =====================================================================

-- 1. Clock and config ------------------------------------------------------
create or replace function public.email_now()
returns timestamptz
language sql stable
as $$
  select coalesce(nullif(current_setting('catalyst.email_now', true), '')::timestamptz, now())
$$;

create schema if not exists private;
create table if not exists private.settings (
  key   text primary key,
  value text
);

insert into private.settings (key, value) values
  ('email_daily_limit', '300'),
  ('email_timezone', 'Asia/Karachi'),
  ('email_app_url', 'https://catalyst.umerfarooqsqa.workers.dev'),
  ('email_dispatch_url', 'https://catalyst.umerfarooqsqa.workers.dev/api/email/dispatch')
on conflict (key) do nothing;

create or replace function public.email_config(p_key text, p_default text)
returns text
language sql stable security definer
set search_path = public, private
as $$
  select coalesce((select nullif(value, '') from private.settings where key = p_key), p_default)
$$;

create or replace function public.email_quota_limit()
returns integer
language sql stable security definer
set search_path = public
as $$ select coalesce(nullif(public.email_config('email_daily_limit', '300'), '')::integer, 300) $$;

-- Midnight today in the email time zone.
create or replace function public.email_day_start()
returns timestamptz
language sql stable security definer
set search_path = public
as $$
  select date_trunc('day', public.email_now() at time zone public.email_config('email_timezone', 'Asia/Karachi'))
           at time zone public.email_config('email_timezone', 'Asia/Karachi')
$$;

-- The most recent digest moment for a digest time: today's if it has passed, else yesterday's.
create or replace function public.email_last_digest(p_time time)
returns timestamptz
language sql stable security definer
set search_path = public
as $$
  select case when t <= public.email_now() then t else t - interval '1 day' end
  from (
    select (date_trunc('day', public.email_now() at time zone public.email_config('email_timezone', 'Asia/Karachi'))
              + p_time) at time zone public.email_config('email_timezone', 'Asia/Karachi') as t
  ) s
$$;

-- 2. Tables ------------------------------------------------------------------
create table if not exists public.project_email_settings (
  project_id     uuid primary key references public.projects(id) on delete cascade,
  mode           text not null default 'auto_batch'
                   check (mode in ('instant', 'auto_batch', 'daily_digest')),
  batch_size     integer not null default 5 check (batch_size between 1 and 50),
  fallback_hours integer not null default 4 check (fallback_hours between 1 and 72),
  digest_time    time not null default '09:00',
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id) on delete set null
);

alter table public.project_email_settings enable row level security;
drop policy if exists project_email_settings_select on public.project_email_settings;
create policy project_email_settings_select on public.project_email_settings
  for select to authenticated using (true);
drop policy if exists project_email_settings_insert on public.project_email_settings;
create policy project_email_settings_insert on public.project_email_settings
  for insert to authenticated with check (public.is_qa_or_admin());
drop policy if exists project_email_settings_update on public.project_email_settings;
create policy project_email_settings_update on public.project_email_settings
  for update to authenticated using (public.is_qa_or_admin()) with check (public.is_qa_or_admin());

-- Everyone is emailed about what the bell tells them; a row here turns one kind (or 'all') off.
create table if not exists public.email_opt_outs (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  event_type text not null
               check (event_type in ('all', 'assignment', 'status_change', 'comment', 'retest_ready')),
  created_at timestamptz not null default now(),
  primary key (user_id, event_type)
);

alter table public.email_opt_outs enable row level security;
drop policy if exists email_opt_outs_select on public.email_opt_outs;
create policy email_opt_outs_select on public.email_opt_outs
  for select to authenticated using (user_id = auth.uid());
drop policy if exists email_opt_outs_insert on public.email_opt_outs;
create policy email_opt_outs_insert on public.email_opt_outs
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists email_opt_outs_delete on public.email_opt_outs;
create policy email_opt_outs_delete on public.email_opt_outs
  for delete to authenticated using (user_id = auth.uid());

-- Bugs waiting to be batched, one row per person and bug.
create table if not exists public.email_pending (
  id              bigint generated always as identity primary key,
  recipient_id    uuid references public.profiles(id) on delete cascade,
  recipient_email text not null,
  project_id      uuid not null references public.projects(id) on delete cascade,
  bug_id          uuid not null references public.bugs(id) on delete cascade,
  event_type      text not null,
  created_at      timestamptz not null default public.email_now(),
  updated_at      timestamptz not null default public.email_now(),
  unique (recipient_email, bug_id)
);
create index if not exists email_pending_project_idx on public.email_pending (project_id);

-- Emails to send. items = the bugs listed, as they were when the email was built.
create table if not exists public.email_outbox (
  id              uuid primary key default gen_random_uuid(),
  recipient_id    uuid references public.profiles(id) on delete set null,
  recipient_email text not null,
  kind            text not null check (kind in ('instant', 'critical', 'batch', 'digest')),
  priority        integer not null default 5,
  items           jsonb not null,
  status          text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts        integer not null default 0,
  last_error      text,
  send_after      timestamptz not null default public.email_now(),
  claimed_at      timestamptz,
  sent_at         timestamptz,
  created_at      timestamptz not null default public.email_now()
);
create index if not exists email_outbox_queue_idx on public.email_outbox (status, priority, created_at);
create index if not exists email_outbox_sent_idx on public.email_outbox (sent_at) where status = 'sent';

-- Addresses and queue state: no policies, so only the definer functions and the service role reach them.
alter table public.email_pending enable row level security;
alter table public.email_outbox enable row level security;

-- 3. Building emails --------------------------------------------------------
create or replace function public.email_bug_item(p_bug uuid, p_event text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id,
    'ref', left(b.id::text, 8),
    'title', b.title,
    'project', p.name,
    'project_id', p.id,
    'severity', b.severity,
    'status', b.status,
    'event', p_event,
    'link', rtrim(public.email_config('email_app_url', 'https://catalyst.umerfarooqsqa.workers.dev'), '/')
              || '/projects/' || b.project_id || '/bugs?focus=' || b.id
  )
  from public.bugs b
  join public.projects p on p.id = b.project_id
  where b.id = p_bug
$$;

-- Sent today plus being sent right now.
create or replace function public.email_quota_used()
returns integer
language sql stable security definer
set search_path = public
as $$
  select count(*)::integer from public.email_outbox
  where (status = 'sent' and sent_at >= public.email_day_start())
     or status = 'sending'
$$;

-- No room today for another email beyond what is already queued.
create or replace function public.email_quota_full()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.email_quota_used()
         + (select count(*)::integer from public.email_outbox where status = 'queued')
         >= public.email_quota_limit()
$$;

-- ONE email from all of a person's pending rows; the rows are deleted in this same transaction.
create or replace function public.email_flush(p_email text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_items      jsonb;
  v_recipient  uuid;
  v_all_digest boolean;
  v_id         uuid;
begin
  with gone as (
    delete from public.email_pending where recipient_email = p_email returning *
  )
  select jsonb_agg(public.email_bug_item(g.bug_id, g.event_type) order by b.severity, p.name, b.title),
         (array_agg(g.recipient_id) filter (where g.recipient_id is not null))[1],
         bool_and(coalesce(s.mode, 'auto_batch') = 'daily_digest')
    into v_items, v_recipient, v_all_digest
  from gone g
  join public.bugs b on b.id = g.bug_id
  join public.projects p on p.id = g.project_id
  left join public.project_email_settings s on s.project_id = g.project_id;

  if v_items is null or jsonb_array_length(v_items) = 0 then
    return null;
  end if;

  insert into public.email_outbox (recipient_id, recipient_email, kind, priority, items)
  values (v_recipient, p_email, case when v_all_digest then 'digest' else 'batch' end, 5, v_items)
  returning id into v_id;
  return v_id;
end;
$$;

-- Flush a person's pending bugs if a rule says so. Returns the email's id, or null.
create or replace function public.email_maybe_flush(p_email text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_now        timestamptz := public.email_now();
  v_auto       integer;
  v_n          integer;
  v_old        boolean;
  v_digest_due boolean;
  v_instant    boolean;
begin
  -- Another transaction is deciding for this person: never wait (no deadlocks); the sweep picks it up.
  if not pg_try_advisory_xact_lock(hashtext('catalyst-email:' || p_email)) then
    return null;
  end if;
  -- Quota used up: keep collecting, one bigger email after the reset.
  if public.email_quota_full() then
    return null;
  end if;

  select count(*) filter (where coalesce(s.mode, 'auto_batch') = 'auto_batch'),
         min(coalesce(s.batch_size, 5)) filter (where coalesce(s.mode, 'auto_batch') = 'auto_batch'),
         coalesce(bool_or(coalesce(s.mode, 'auto_batch') = 'auto_batch'
                          and pe.created_at <= v_now - make_interval(hours => coalesce(s.fallback_hours, 4))), false),
         coalesce(bool_or(s.mode = 'daily_digest'
                          and pe.created_at < public.email_last_digest(s.digest_time)), false),
         -- the project was switched to instant while bugs were pending
         coalesce(bool_or(s.mode = 'instant'), false)
    into v_auto, v_n, v_old, v_digest_due, v_instant
  from public.email_pending pe
  left join public.project_email_settings s on s.project_id = pe.project_id
  where pe.recipient_email = p_email;

  if (v_n is not null and v_auto >= v_n) or v_old or v_digest_due or v_instant then
    return public.email_flush(p_email);
  end if;
  return null;
end;
$$;

-- 4. Entry point: one bug event for one person ------------------------------
create or replace function public.email_enqueue(p_user uuid, p_bug uuid, p_event text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_email    text;
  v_project  uuid;
  v_severity public.bug_severity;
  v_mode     text;
  v_critical boolean;
begin
  select lower(trim(email)) into v_email from public.profiles where id = p_user;
  if v_email is null or position('@' in v_email) = 0 then
    return;
  end if;
  if exists (select 1 from public.email_opt_outs
             where user_id = p_user and event_type in ('all', p_event)) then
    return;
  end if;

  select project_id, severity into v_project, v_severity from public.bugs where id = p_bug;
  if v_project is null then
    return;
  end if;
  v_mode := coalesce((select mode from public.project_email_settings where project_id = v_project), 'auto_batch');
  v_critical := v_severity = 'critical';

  if v_critical or v_mode = 'instant' then
    -- This email shows the bug's latest state, so a pending row for it would only repeat it.
    delete from public.email_pending where recipient_email = v_email and bug_id = p_bug;
    insert into public.email_outbox (recipient_id, recipient_email, kind, priority, items)
    values (p_user, v_email,
            case when v_critical then 'critical' else 'instant' end,
            case when v_critical then 0 else 5 end,
            jsonb_build_array(public.email_bug_item(p_bug, p_event)));
    return;
  end if;

  insert into public.email_pending (recipient_id, recipient_email, project_id, bug_id, event_type)
  values (p_user, v_email, v_project, p_bug, p_event)
  on conflict (recipient_email, bug_id) do update
    set event_type = excluded.event_type,
        project_id = excluded.project_id,
        updated_at = public.email_now();

  if v_mode = 'auto_batch' then
    perform public.email_maybe_flush(v_email);
  end if;
end;
$$;

-- 5. Hooks ---------------------------------------------------------------------
create or replace function public.notifications_email()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.related_bug_id is not null
     and new.type::text in ('assignment', 'status_change', 'comment', 'retest_ready') then
    perform public.email_enqueue(new.user_id, new.related_bug_id, new.type::text);
  end if;
  return new;
exception when others then
  -- Email must never block the bug change or the bell.
  raise warning 'email_enqueue failed for notification %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_notifications_email on public.notifications;
create trigger trg_notifications_email
  after insert on public.notifications
  for each row execute function public.notifications_email();

-- A bug created already assigned (by hand or by the area's default developer, 0035/0043) pings the assignee.
create or replace function public.bugs_notify_insert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.assignee_id is not null
     and new.assignee_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) then
    insert into public.notifications (user_id, type, message, related_bug_id)
    values (new.assignee_id, 'assignment', 'New bug assigned to you: ' || new.title, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bugs_notify_insert on public.bugs;
create trigger trg_bugs_notify_insert
  after insert on public.bugs
  for each row execute function public.bugs_notify_insert();

-- 6. Sending -------------------------------------------------------------------
-- Ping the app to send what is queued. No-op until email_dispatch_url is set.
create or replace function public.email_kick()
returns void
language plpgsql security definer
set search_path = public, net
as $$
declare
  v_url text := public.email_config('email_dispatch_url', '');
begin
  if v_url = '' then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    -- the app sends for up to ~20 s before it answers
    timeout_milliseconds := 30000
  );
exception when others then
  raise warning 'email_kick failed: %', sqlerrm;
end;
$$;

create or replace function public.email_outbox_kick()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.email_kick();
  return null;
end;
$$;

drop trigger if exists trg_email_outbox_kick on public.email_outbox;
create trigger trg_email_outbox_kick
  after insert on public.email_outbox
  for each statement execute function public.email_outbox_kick();

-- Claim emails to send now, never more than today's quota leaves room for. Critical first.
create or replace function public.email_claim(p_limit integer default 20)
returns setof public.email_outbox
language plpgsql security definer
set search_path = public
as $$
declare
  v_room integer;
begin
  -- one claimer at a time, so two dispatchers can't overshoot the quota together
  perform pg_advisory_xact_lock(hashtext('catalyst-email-claim'));
  -- a dispatcher that died mid-send: retry after 10 minutes
  update public.email_outbox set status = 'queued', claimed_at = null
   where status = 'sending' and claimed_at < public.email_now() - interval '10 minutes';

  v_room := greatest(public.email_quota_limit() - public.email_quota_used(), 0);
  if v_room = 0 then
    return;
  end if;

  return query
  update public.email_outbox o
     set status = 'sending', claimed_at = public.email_now(), attempts = o.attempts + 1
   where o.id in (
     select id from public.email_outbox
      where status = 'queued' and send_after <= public.email_now()
      order by priority, created_at
      limit least(greatest(p_limit, 0), v_room)
      for update skip locked
   )
  returning o.*;
end;
$$;

-- Report one claimed email. A failure retries with back-off, then gives up after 5 attempts;
-- p_final gives up at once (an address that can never be delivered).
drop function if exists public.email_mark(uuid, boolean, text);
create or replace function public.email_mark(p_id uuid, p_ok boolean, p_error text default null, p_final boolean default false)
returns void
language sql security definer
set search_path = public
as $$
  update public.email_outbox
     set status     = case when p_ok then 'sent' when p_final or attempts >= 5 then 'failed' else 'queued' end,
         sent_at    = case when p_ok then public.email_now() else null end,
         last_error = case when p_ok then null else left(p_error, 500) end,
         send_after = case when p_ok then send_after
                           else public.email_now() + make_interval(mins => 5 * attempts) end,
         claimed_at = null
   where id = p_id and status = 'sending'
$$;

-- Every 5 minutes: time fallback, digests, and a ping for emails that were waiting.
create or replace function public.email_sweep()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  r     record;
  v_new integer := 0;
begin
  for r in select distinct recipient_email from public.email_pending loop
    if public.email_maybe_flush(r.recipient_email) is not null then
      v_new := v_new + 1;
    end if;
  end loop;
  -- new emails already pinged through the insert trigger
  if v_new = 0 and exists (select 1 from public.email_outbox
                           where status = 'queued' and send_after <= public.email_now()) then
    perform public.email_kick();
  end if;
  return v_new;
end;
$$;

-- 7. Counters for the Bugs page (QA/admin only; nobody reads the addresses) -------
create or replace function public.email_stats(p_project uuid default null)
returns table (
  sent_today           integer,
  daily_limit          integer,
  queued               integer,
  pending_bugs         integer,
  pending_people       integer,
  project_pending_bugs integer
)
language sql stable security definer
set search_path = public
as $$
  select public.email_quota_used(),
         public.email_quota_limit(),
         (select count(*)::integer from public.email_outbox where status = 'queued'),
         (select count(distinct bug_id)::integer from public.email_pending),
         (select count(distinct recipient_email)::integer from public.email_pending),
         (select count(distinct bug_id)::integer from public.email_pending where project_id = p_project)
  where public.is_qa_or_admin()
$$;

-- 8. Privileges -----------------------------------------------------------------
revoke all on function public.email_config(text, text) from public, anon, authenticated;
revoke all on function public.email_quota_limit() from public, anon, authenticated;
revoke all on function public.email_day_start() from public, anon, authenticated;
revoke all on function public.email_last_digest(time) from public, anon, authenticated;
revoke all on function public.email_bug_item(uuid, text) from public, anon, authenticated;
revoke all on function public.email_quota_used() from public, anon, authenticated;
revoke all on function public.email_quota_full() from public, anon, authenticated;
revoke all on function public.email_flush(text) from public, anon, authenticated;
revoke all on function public.email_maybe_flush(text) from public, anon, authenticated;
revoke all on function public.email_enqueue(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.notifications_email() from public, anon, authenticated;
revoke all on function public.bugs_notify_insert() from public, anon, authenticated;
revoke all on function public.email_kick() from public, anon, authenticated;
revoke all on function public.email_outbox_kick() from public, anon, authenticated;
revoke all on function public.email_claim(integer) from public, anon, authenticated;
revoke all on function public.email_mark(uuid, boolean, text, boolean) from public, anon, authenticated;
revoke all on function public.email_sweep() from public, anon, authenticated;
revoke all on function public.email_stats(uuid) from public, anon;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.email_claim(integer) to service_role;
    grant execute on function public.email_mark(uuid, boolean, text, boolean) to service_role;
    grant execute on function public.email_sweep() to service_role;
  end if;
end;
$$;
grant execute on function public.email_stats(uuid) to authenticated;

-- 9. The sweep (pg_cron; skipped where the extension is absent) ------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'catalyst-email-sweep') then
      perform cron.unschedule('catalyst-email-sweep');
    end if;
    perform cron.schedule('catalyst-email-sweep', '*/5 * * * *', 'select public.email_sweep()');
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end;
$$;
