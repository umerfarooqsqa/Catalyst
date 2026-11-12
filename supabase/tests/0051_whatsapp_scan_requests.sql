-- Tests for 0051_whatsapp_scan_requests.sql. ONE transaction that always ends in an error carrying
-- the results ("SCAN TESTS: n passed, m failed"), so nothing is ever committed.
-- Run: node scripts/whatsapp-import-test.mjs (live, Management API), or any psql session.
-- Real scan requests may exist on the live database: they are parked as cancelled inside this
-- transaction (rolled back with everything else) so the checks start from a clean slate.
begin;

create temp table t_results (n serial, name text, ok boolean, detail text) on commit drop;
create temp table t_ids (name text primary key, id uuid) on commit drop;
grant all on t_results, t_ids to authenticated;
grant usage on sequence t_results_n_seq to authenticated;
create function pg_temp.check(p_name text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into t_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;
create function pg_temp.id(p_name text) returns uuid
language sql as $$ select id from t_ids where name = p_name $$;
create function pg_temp.as_user(p_name text) returns void
language sql as $$ select set_config('request.jwt.claims',
  json_build_object('sub', (select id from t_ids where name = p_name), 'role', 'authenticated')::text, true) $$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), 'sc-qa@login-test.invalid',
       jsonb_build_object('full_name', 'Scan QA', 'role', (select key from public.roles where level = 'manager' order by key limit 1));
insert into t_ids select 'qa', id from auth.users where email = 'sc-qa@login-test.invalid';
insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), 'sc-dev@login-test.invalid',
       jsonb_build_object('full_name', 'Scan Dev', 'role', (select key from public.roles where level = 'contributor' order by key limit 1));
insert into t_ids select 'dev', id from auth.users where email = 'sc-dev@login-test.invalid';

-- clean slate: no open or completed requests during the test (all rolled back)
update public.whatsapp_scan_requests set status = 'cancelled' where status <> 'cancelled';

-- ---- asking ----------------------------------------------------------------------------------------
select pg_temp.as_user('dev');
do $$ begin
  perform public.whatsapp_request_scan();
  insert into t_results (name, ok) values ('a developer cannot ask for a scan', false);
exception when insufficient_privilege then
  insert into t_results (name, ok) values ('a developer cannot ask for a scan', true);
end $$;

select pg_temp.as_user('qa');
insert into t_ids select 'r1', (public.whatsapp_request_scan()).id;
select pg_temp.check('QA asks: a pending request for all groups, since 7 days ago, by QA',
  (select status = 'pending' and scope = 'all_groups' and requested_by = pg_temp.id('qa')
          and abs(extract(epoch from (since - (now() - interval '7 days')))) < 5
     from public.whatsapp_scan_requests where id = pg_temp.id('r1')));
select pg_temp.check('asking again returns the same open request (no second one)',
  (public.whatsapp_request_scan()).id = pg_temp.id('r1')
  and (select count(*) from public.whatsapp_scan_requests where status in ('pending', 'seen')) = 1);

-- ---- Grok's GET ----------------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
create temp table t_seen on commit drop as select public.whatsapp_scan_pending() j;
select pg_temp.check('Grok''s GET returns the request with its instructions and marks it seen',
  (select (j->>'id')::uuid = pg_temp.id('r1') and j->>'requested_by' = 'Scan QA' and j->>'instructions' like 'Scan ALL WhatsApp groups%'
     from t_seen)
  and (select status = 'seen' and seen_at is not null from public.whatsapp_scan_requests where id = pg_temp.id('r1')),
  (select j::text from t_seen));
create temp table t_seen_at on commit drop as
  select seen_at from public.whatsapp_scan_requests where id = pg_temp.id('r1');
select pg_temp.check('a second GET still returns it, seen_at unchanged',
  (public.whatsapp_scan_pending()->>'id')::uuid = pg_temp.id('r1')
  and (select seen_at from public.whatsapp_scan_requests where id = pg_temp.id('r1')) = (select seen_at from t_seen_at));

-- ---- Grok's POSTs --------------------------------------------------------------------------------
select public.whatsapp_scan_report(pg_temp.id('r1'), 500, null, false);
select pg_temp.check('a batch with scan_done = false counts its rows and keeps the request open',
  (select status = 'seen' and rows_received = 500 and completed_at is null
     from public.whatsapp_scan_requests where id = pg_temp.id('r1')));
create temp table t_done on commit drop as
  select public.whatsapp_scan_report(pg_temp.id('r1'), 12, 'Scanned 9 groups, 3 new items', true) j;
select pg_temp.check('the last batch completes it: rows added up, note kept',
  (select status = 'done' and rows_received = 512 and completed_at is not null and note = 'Scanned 9 groups, 3 new items'
     from public.whatsapp_scan_requests where id = pg_temp.id('r1'))
  and (select j->>'status' = 'done' and (j->>'rows_received')::int = 512 from t_done));
select pg_temp.check('a report for a finished request is ignored',
  (select (j->>'ignored')::boolean and j->>'status' = 'done'
     from (select public.whatsapp_scan_report(pg_temp.id('r1'), 5, null, true) j) x)
  and (select rows_received = 512 from public.whatsapp_scan_requests where id = pg_temp.id('r1')));
select pg_temp.check('a report for an unknown id is ignored',
  (select (j->>'ignored')::boolean and j->>'reason' = 'no such scan request'
     from (select public.whatsapp_scan_report(gen_random_uuid(), 5, null, true) j) x));
select pg_temp.check('no open request: Grok''s GET returns null', public.whatsapp_scan_pending() is null);

-- ---- the next scan starts where the last one ended ---------------------------------------------
select pg_temp.as_user('qa');
insert into t_ids select 'r2', (public.whatsapp_request_scan()).id;
select pg_temp.check('the next request covers messages since the last completed scan minus 1 hour',
  (select r2.since = r1.completed_at - interval '1 hour'
     from public.whatsapp_scan_requests r1, public.whatsapp_scan_requests r2
    where r1.id = pg_temp.id('r1') and r2.id = pg_temp.id('r2')));
create temp table t_cancel on commit drop as select public.whatsapp_cancel_scan(pg_temp.id('r2')) ok;
select pg_temp.check('QA cancels an open request', (select ok from t_cancel)
  and (select status = 'cancelled' from public.whatsapp_scan_requests where id = pg_temp.id('r2')));
select pg_temp.check('a report for a cancelled request is ignored',
  (select (j->>'ignored')::boolean from (select public.whatsapp_scan_report(pg_temp.id('r2'), 3, null, true) j) x));

-- ---- a request nobody picked up expires after 24 hours -------------------------------------------
insert into t_ids select 'r3', (public.whatsapp_request_scan()).id;
update public.whatsapp_scan_requests set requested_at = now() - interval '25 hours' where id = pg_temp.id('r3');
insert into t_ids select 'r4', (public.whatsapp_request_scan()).id;
select pg_temp.check('asking again after 24 hours expires the old request and opens a new one',
  pg_temp.id('r4') <> pg_temp.id('r3')
  and (select status = 'expired' from public.whatsapp_scan_requests where id = pg_temp.id('r3'))
  and (select status = 'pending' from public.whatsapp_scan_requests where id = pg_temp.id('r4')));

-- ---- the portal records whether Grok's webhook took the request ---------------------------------
select public.whatsapp_scan_notified(pg_temp.id('r4'), 'Grok''s webhook answered HTTP 500');
select pg_temp.check('a failed webhook call is recorded, not as notified',
  (select notify_error = 'Grok''s webhook answered HTTP 500' and notified_at is null
     from public.whatsapp_scan_requests where id = pg_temp.id('r4')));
select public.whatsapp_scan_notified(pg_temp.id('r4'), null);
select pg_temp.check('a successful call sets notified_at and clears the error',
  (select notified_at is not null and notify_error is null and status = 'pending'
     from public.whatsapp_scan_requests where id = pg_temp.id('r4')));

-- ---- who can do what -----------------------------------------------------------------------------
set local role authenticated;
select pg_temp.check('QA reads the requests', (select count(*) >= 4 from public.whatsapp_scan_requests));
do $$ begin
  perform public.whatsapp_scan_pending();
  insert into t_results (name, ok) values ('a signed-in user cannot call Grok''s GET function', false);
exception when insufficient_privilege then
  insert into t_results (name, ok) values ('a signed-in user cannot call Grok''s GET function', true);
end $$;
do $$ begin
  perform public.whatsapp_scan_report(gen_random_uuid(), 1, null, true);
  insert into t_results (name, ok) values ('a signed-in user cannot report a scan', false);
exception when insufficient_privilege then
  insert into t_results (name, ok) values ('a signed-in user cannot report a scan', true);
end $$;
do $$ begin
  perform public.whatsapp_scan_notified(gen_random_uuid(), null);
  insert into t_results (name, ok) values ('a signed-in user cannot record a webhook call', false);
exception when insufficient_privilege then
  insert into t_results (name, ok) values ('a signed-in user cannot record a webhook call', true);
end $$;
do $$ begin
  update public.whatsapp_scan_requests set status = 'done';
  insert into t_results (name, ok) values ('nobody writes the requests table directly',
    not exists (select 1 from public.whatsapp_scan_requests where status = 'done' and id = (select id from t_ids where name = 'r4')));
exception when insufficient_privilege then
  insert into t_results (name, ok) values ('nobody writes the requests table directly', true);
end $$;
reset role;
select pg_temp.as_user('dev');
set local role authenticated;
select pg_temp.check('a developer reads no requests', (select count(*) = 0 from public.whatsapp_scan_requests));
reset role;

select set_config('request.jwt.claims', '', true);
do $$
declare v text;
begin
  select format('SCAN TESTS: %s passed, %s failed%s',
                count(*) filter (where ok), count(*) filter (where not ok),
                coalesce(E'\n' || string_agg(format('FAIL %s %s', name, coalesce(detail, '')), E'\n') filter (where not ok), ''))
    into v from t_results;
  raise exception '%', v;
end $$;
