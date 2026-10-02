-- Tests for 0044_email_batching.sql and 0045_notification_emails.sql. Runs in ONE transaction that always ends in an
-- error carrying the results ("EMAIL TESTS: n passed, m failed"), so nothing is ever
-- committed, even if the runner forgets to roll back. Synthetic users/projects/bugs only.
-- Run: node scripts/email-batching-test.mjs (live, Management API), or any psql session.
-- The "two events at once" case needs two connections: scripts/email-batching-test.mjs.
begin;

-- A clock far from real data, a quota nothing real touches, and no pings to the app.
set local catalyst.email_now = '2030-03-04 10:00:00+05';
update private.settings set value = '100000' where key = 'email_daily_limit';
update private.settings set value = '' where key = 'email_dispatch_url';

create temp table t_results (n serial, name text, ok boolean, detail text) on commit drop;
create temp table t_ids (name text primary key, id uuid) on commit drop;
-- section 12 runs checks as the signed-in role
grant all on t_results, t_ids to authenticated;
grant usage on sequence t_results_n_seq to authenticated;

create function pg_temp.check(p_name text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into t_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;

create function pg_temp.id(p_name text) returns uuid
language sql as $$ select id from t_ids where name = p_name $$;

create function pg_temp.user(p_name text) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  -- the login address is NOT where email goes (0045): that is notification_emails
  insert into auth.users (id, email, raw_user_meta_data)
  values (v, p_name || '@login-test.invalid', jsonb_build_object('full_name', 'Email test ' || p_name));
  insert into public.notification_emails (user_id, email) values (v, ' ' || upper(p_name) || '@Email-Test.invalid ');
  insert into t_ids values (p_name, v);
  return v;
end $$;

create function pg_temp.project(p_name text, p_mode text, p_n integer default 5) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.projects (name) values ('Email test ' || p_name) returning id into v;
  if p_mode is not null then
    insert into public.project_email_settings (project_id, mode, batch_size) values (v, p_mode, p_n);
  end if;
  insert into t_ids values (p_name, v);
  return v;
end $$;

create function pg_temp.bug(p_name text, p_project text, p_severity text default 'minor') returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.bugs (project_id, title, severity)
  values (pg_temp.id(p_project), 'Email test bug ' || p_name, p_severity::public.bug_severity)
  returning id into v;
  insert into t_ids values (p_name, v);
  return v;
end $$;

-- One bug event for one person, the way the bell creates it.
create function pg_temp.ev(p_user text, p_bug text, p_type text default 'status_change') returns void
language sql as $$
  insert into public.notifications (user_id, type, message, related_bug_id)
  values (pg_temp.id(p_user), p_type::public.notification_type, 'test', pg_temp.id(p_bug))
$$;

create function pg_temp.outbox(p_user text) returns bigint
language sql as $$ select count(*) from public.email_outbox where recipient_email = p_user || '@email-test.invalid' $$;

create function pg_temp.pending(p_user text) returns bigint
language sql as $$ select count(*) from public.email_pending where recipient_email = p_user || '@email-test.invalid' $$;

create function pg_temp.at(p_ts text) returns void
language sql as $$ select set_config('catalyst.email_now', p_ts, true) $$;

-- Setup -------------------------------------------------------------------------
select pg_temp.user('alice'), pg_temp.user('bob'), pg_temp.user('carol'), pg_temp.user('dave'),
       pg_temp.user('erin'), pg_temp.user('frank'), pg_temp.user('gina');
select pg_temp.project('p_default', null),            -- no settings row: auto-batch, N = 5
       pg_temp.project('p_batch', 'auto_batch', 5),
       pg_temp.project('p_instant', 'instant'),
       pg_temp.project('p_digest', 'daily_digest');

-- 1. Four bugs -> no email --------------------------------------------------------
select pg_temp.bug('a1', 'p_default'), pg_temp.bug('a2', 'p_default'),
       pg_temp.bug('a3', 'p_default'), pg_temp.bug('a4', 'p_batch'), pg_temp.bug('a5', 'p_batch');
select pg_temp.ev('alice', 'a1'), pg_temp.ev('alice', 'a2'), pg_temp.ev('alice', 'a3'), pg_temp.ev('alice', 'a4');
select pg_temp.check('4 bugs: no email', pg_temp.outbox('alice') = 0, pg_temp.outbox('alice')::text);
select pg_temp.check('4 bugs: 4 pending', pg_temp.pending('alice') = 4, pg_temp.pending('alice')::text);

-- 2. 5th bug -> exactly one email with all 5, across two projects --------------------
select pg_temp.ev('alice', 'a5');
select pg_temp.check('5th bug: exactly one email', pg_temp.outbox('alice') = 1, pg_temp.outbox('alice')::text);
select pg_temp.check('5th bug: it lists all 5',
  (select jsonb_array_length(items) from public.email_outbox where recipient_email = 'alice@email-test.invalid') = 5);
select pg_temp.check('5th bug: one email covers both projects',
  (select count(distinct i->>'project_id') from public.email_outbox o, jsonb_array_elements(o.items) i
    where o.recipient_email = 'alice@email-test.invalid') = 2);
select pg_temp.check('5th bug: kind batch, link and fields present',
  (select kind = 'batch' and items->0 ?& array['ref', 'title', 'project', 'severity', 'status', 'link']
     from public.email_outbox where recipient_email = 'alice@email-test.invalid'));
select pg_temp.check('5th bug: pending cleared', pg_temp.pending('alice') = 0);
select pg_temp.check('flushing again sends nothing', public.email_flush('alice@email-test.invalid') is null
  and pg_temp.outbox('alice') = 1);

-- 3. Critical bug -> sent immediately ------------------------------------------------
select pg_temp.bug('c1', 'p_default', 'critical');
select pg_temp.ev('alice', 'a1');                -- one ordinary pending bug first
select pg_temp.ev('alice', 'c1');
select pg_temp.check('critical: its own email right away',
  (select count(*) from public.email_outbox
    where recipient_email = 'alice@email-test.invalid' and kind = 'critical' and priority = 0
      and items->0->>'id' = pg_temp.id('c1')::text) = 1);
select pg_temp.check('critical: not added to the batch', pg_temp.pending('alice') = 1);
-- a pending bug that becomes critical leaves the batch and goes out at once
update public.bugs set severity = 'critical' where id = pg_temp.id('a1');
select pg_temp.ev('alice', 'a1');
select pg_temp.check('pending bug turned critical: sent, pending row gone',
  pg_temp.pending('alice') = 0
  and (select count(*) from public.email_outbox where recipient_email = 'alice@email-test.invalid'
        and kind = 'critical' and items->0->>'id' = pg_temp.id('a1')::text) = 1);

-- 4. Time fallback flushes 3 old bugs ----------------------------------------------
select pg_temp.bug('k1', 'p_default'), pg_temp.bug('k2', 'p_default'), pg_temp.bug('k3', 'p_batch');
select pg_temp.ev('carol', 'k1'), pg_temp.ev('carol', 'k2'), pg_temp.ev('carol', 'k3');
select pg_temp.at('2030-03-04 13:59:00+05'); select public.email_sweep();
select pg_temp.check('fallback: nothing before 4 hours', pg_temp.outbox('carol') = 0 and pg_temp.pending('carol') = 3);
select pg_temp.at('2030-03-04 14:00:00+05'); select public.email_sweep();
select pg_temp.check('fallback: one email with the 3 bugs after 4 hours',
  pg_temp.outbox('carol') = 1 and pg_temp.pending('carol') = 0
  and (select jsonb_array_length(items) from public.email_outbox where recipient_email = 'carol@email-test.invalid') = 3);
select pg_temp.at('2030-03-04 10:00:00+05');

-- 5. Same bug changing while pending: shown once, latest status ----------------------
select pg_temp.bug('d1', 'p_default'), pg_temp.bug('d2', 'p_default'), pg_temp.bug('d3', 'p_default'),
       pg_temp.bug('d4', 'p_default'), pg_temp.bug('d5', 'p_default');
select pg_temp.ev('dave', 'd1');
update public.bugs set status = 'in_progress' where id = pg_temp.id('d1');
select pg_temp.ev('dave', 'd1');
update public.bugs set status = 'fixed' where id = pg_temp.id('d1');
select pg_temp.ev('dave', 'd1', 'retest_ready');
select pg_temp.check('same bug 3 times: one pending row', pg_temp.pending('dave') = 1);
select pg_temp.ev('dave', 'd2'), pg_temp.ev('dave', 'd3'), pg_temp.ev('dave', 'd4');
select pg_temp.check('same bug: 3 changes + 3 bugs count as 4, no email', pg_temp.outbox('dave') = 0);
select pg_temp.ev('dave', 'd5');
select pg_temp.check('same bug: listed once with its latest status',
  (select count(*) filter (where i->>'id' = pg_temp.id('d1')::text) = 1
      and max(i->>'status') filter (where i->>'id' = pg_temp.id('d1')::text) = 'fixed'
      and count(*) = 5
     from public.email_outbox o, jsonb_array_elements(o.items) i
    where o.recipient_email = 'dave@email-test.invalid'));

-- 6. Instant mode ---------------------------------------------------------------------
select pg_temp.bug('i1', 'p_instant');
select pg_temp.ev('bob', 'i1'), pg_temp.ev('bob', 'i1', 'comment');
select pg_temp.check('instant: one email per event, nothing pending',
  (select count(*) from public.email_outbox where recipient_email = 'bob@email-test.invalid' and kind = 'instant') = 2
  and pg_temp.pending('bob') = 0);

-- 7. Daily digest at 09:00 ------------------------------------------------------------
select pg_temp.bug('g1', 'p_digest'), pg_temp.bug('g2', 'p_digest');
select pg_temp.ev('gina', 'g1'), pg_temp.ev('gina', 'g2');
select pg_temp.at('2030-03-04 23:00:00+05'); select public.email_sweep();
select pg_temp.check('digest: waits for the next 09:00', pg_temp.outbox('gina') = 0 and pg_temp.pending('gina') = 2);
select pg_temp.at('2030-03-05 09:01:00+05'); select public.email_sweep();
select pg_temp.check('digest: one digest email the next morning',
  (select count(*) from public.email_outbox where recipient_email = 'gina@email-test.invalid' and kind = 'digest'
      and jsonb_array_length(items) = 2) = 1 and pg_temp.pending('gina') = 0);
select pg_temp.ev('gina', 'g1');
select public.email_sweep();
select pg_temp.check('digest: a bug after today''s digest waits for tomorrow', pg_temp.pending('gina') = 1);
select pg_temp.at('2030-03-04 10:00:00+05');

-- 8. Opt-out, and a bug created already assigned ---------------------------------------
insert into public.email_opt_outs (user_id, event_type) values (pg_temp.id('frank'), 'comment');
select pg_temp.bug('f1', 'p_default');
select pg_temp.ev('frank', 'f1', 'comment');
select pg_temp.check('opt-out: no comment email', pg_temp.pending('frank') = 0 and pg_temp.outbox('frank') = 0);
insert into public.bugs (project_id, title, severity, assignee_id)
values (pg_temp.id('p_default'), 'Email test bug f2', 'minor', pg_temp.id('frank'));
select pg_temp.check('new assigned bug: bell ping + pending for the assignee',
  pg_temp.pending('frank') = 1
  and exists (select 1 from public.notifications where user_id = pg_temp.id('frank') and type = 'assignment'));

-- 9. Quota full: batch deferred, critical waits, then both go out after the reset -----
update public.email_outbox set status = 'sent', sent_at = public.email_now()
 where recipient_email like '%@email-test.invalid';
update private.settings set value = public.email_quota_used()::text where key = 'email_daily_limit';
select pg_temp.bug('e1', 'p_default'), pg_temp.bug('e2', 'p_default'), pg_temp.bug('e3', 'p_default'),
       pg_temp.bug('e4', 'p_default'), pg_temp.bug('e5', 'p_default'), pg_temp.bug('e6', 'p_default', 'critical');
select pg_temp.ev('erin', 'e1'), pg_temp.ev('erin', 'e2'), pg_temp.ev('erin', 'e3'),
       pg_temp.ev('erin', 'e4'), pg_temp.ev('erin', 'e5');
select pg_temp.check('quota full: 5 bugs, no batch built', pg_temp.outbox('erin') = 0 and pg_temp.pending('erin') = 5);
select pg_temp.at('2030-03-04 15:00:00+05'); select public.email_sweep();
select pg_temp.check('quota full: fallback waits too', pg_temp.outbox('erin') = 0);
select pg_temp.ev('erin', 'e6');
select pg_temp.check('quota full: critical still queued', pg_temp.outbox('erin') = 1);
select pg_temp.check('quota full: nothing can be claimed', (select count(*) from public.email_claim(50)) = 0);
select pg_temp.at('2030-03-05 00:05:00+05'); select public.email_sweep();
select pg_temp.check('after the reset: ONE batch with all 5',
  (select count(*) from public.email_outbox where recipient_email = 'erin@email-test.invalid'
      and kind = 'batch' and jsonb_array_length(items) = 5) = 1 and pg_temp.pending('erin') = 0);

-- 10. Claim and mark --------------------------------------------------------------------
update private.settings set value = '100000' where key = 'email_daily_limit';
create temp table t_claimed on commit drop as select * from public.email_claim(50);
select pg_temp.check('claim: critical comes first',
  (select kind from t_claimed order by priority, created_at limit 1) = 'critical');
select pg_temp.check('claim: claimed rows are sending',
  (select bool_and(o.status = 'sending') from public.email_outbox o join t_claimed c on c.id = o.id));
select pg_temp.check('claim: a second claim gets nothing new',
  (select count(*) from public.email_claim(50) x where x.id in (select id from t_claimed)) = 0);
select public.email_mark(id, true) from t_claimed where kind = 'critical';
select public.email_mark(id, false, 'smtp said no') from t_claimed where kind = 'batch';
select pg_temp.check('mark: sent', (select bool_and(o.status = 'sent' and o.sent_at is not null)
  from public.email_outbox o join t_claimed c on c.id = o.id where c.kind = 'critical'));
select pg_temp.check('mark: failure re-queued with back-off', (select bool_and(o.status = 'queued'
  and o.send_after > public.email_now() and o.last_error = 'smtp said no')
  from public.email_outbox o join t_claimed c on c.id = o.id where c.kind = 'batch'));
select pg_temp.bug('u1', 'p_instant');
select pg_temp.ev('frank', 'u1');
create temp table t_final on commit drop as select * from public.email_claim(50);
select public.email_mark(id, false, 'undeliverable test address', true) from t_final;
select pg_temp.check('mark: final failure is not retried',
  (select count(*) > 0 and bool_and(o.status = 'failed') from public.email_outbox o join t_final c on c.id = o.id));
select pg_temp.check('quota: counts 1 per email',
  public.email_quota_used() = (select count(*) from public.email_outbox
                               where (status = 'sent' and sent_at >= public.email_day_start()) or status = 'sending'));

-- 11. Where emails go (0045) ---------------------------------------------------------
select pg_temp.check('address stored trimmed and lower-case',
  (select email from public.notification_emails where user_id = pg_temp.id('alice')) = 'alice@email-test.invalid');
select pg_temp.check('nothing addressed to a login email',
  not exists (select 1 from public.email_outbox where recipient_email like '%@login-test.invalid')
  and not exists (select 1 from public.email_pending where recipient_email like '%@login-test.invalid'));
select pg_temp.user('hana');
delete from public.notification_emails where user_id = pg_temp.id('hana');
select pg_temp.bug('h1', 'p_default', 'critical'), pg_temp.bug('h2', 'p_default');
select pg_temp.ev('hana', 'h1'), pg_temp.ev('hana', 'h2');
select pg_temp.check('no address: no email, not even critical',
  not exists (select 1 from public.email_outbox where recipient_id = pg_temp.id('hana'))
  and not exists (select 1 from public.email_pending where recipient_id = pg_temp.id('hana')));
insert into public.notification_emails (user_id, email) values (pg_temp.id('hana'), 'hana.old@email-test.invalid');
select pg_temp.bug('h3', 'p_default'), pg_temp.bug('h4', 'p_default');
select pg_temp.ev('hana', 'h3'), pg_temp.ev('hana', 'h4');
update public.notification_emails set email = 'hana.new@email-test.invalid' where user_id = pg_temp.id('hana');
select pg_temp.check('changed address takes over the pending bugs',
  (select count(*) from public.email_pending where recipient_email = 'hana.new@email-test.invalid') = 2
  and not exists (select 1 from public.email_pending where recipient_email = 'hana.old@email-test.invalid'));
select pg_temp.ev('hana', 'h1');
select pg_temp.check('critical goes to the new address',
  exists (select 1 from public.email_outbox where recipient_email = 'hana.new@email-test.invalid' and kind = 'critical'));
delete from public.notification_emails where user_id = pg_temp.id('hana');
select pg_temp.check('removed address drops pending bugs and queued emails',
  not exists (select 1 from public.email_pending where recipient_id = pg_temp.id('hana'))
  and not exists (select 1 from public.email_outbox where recipient_id = pg_temp.id('hana') and status = 'queued'));
do $$ begin
  insert into public.notification_emails (user_id, email) values ((select id from t_ids where name = 'hana'), 'not-an-email');
  insert into t_results (name, ok) values ('invalid address refused', false);
exception when check_violation then
  insert into t_results (name, ok) values ('invalid address refused', true);
end $$;

-- 12. Who can read and set an address (RLS, as real sessions) -------------------------
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('alice'), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.check('a user sees only their own address',
  (select count(*) from public.notification_emails) = 1
  and (select user_id from public.notification_emails) = pg_temp.id('alice'));
update public.notification_emails set email = 'alice2@email-test.invalid' where user_id = pg_temp.id('alice');
select pg_temp.check('a user can change their own address',
  (select email from public.notification_emails where user_id = pg_temp.id('alice')) = 'alice2@email-test.invalid');
update public.notification_emails set email = 'hijack@email-test.invalid' where user_id = pg_temp.id('bob');
do $$ begin
  insert into public.notification_emails (user_id, email) values ((select id from t_ids where name = 'hana'), 'x@email-test.invalid');
  insert into t_results (name, ok) values ('a user cannot add an address for someone else', false);
exception when insufficient_privilege then
  insert into t_results (name, ok) values ('a user cannot add an address for someone else', true);
end $$;
reset role;
select pg_temp.check('a user cannot change someone else''s address',
  (select email from public.notification_emails where user_id = pg_temp.id('bob')) = 'bob@email-test.invalid');
select set_config('request.jwt.claims', '', true);

-- 13. Counters: QA/admin only --------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('alice'), 'role', 'authenticated')::text, true);
select pg_temp.check('stats: hidden from a viewer', (select count(*) from public.email_stats(pg_temp.id('p_default'))) = 0);
select set_config('request.jwt.claims', '', true);

-- Results (always rolls back) -------------------------------------------------------------
do $$
declare v text;
begin
  select format('EMAIL TESTS: %s passed, %s failed%s',
                count(*) filter (where ok), count(*) filter (where not ok),
                coalesce(E'\n' || string_agg(format('FAIL %s %s', name, coalesce(detail, '')), E'\n') filter (where not ok), ''))
    into v from t_results;
  raise exception '%', v;
end $$;
