-- Tests for 0047_whatsapp_inbox.sql. ONE transaction that always ends in an error carrying the
-- results ("INBOX TESTS: n passed, m failed"), so nothing is ever committed.
begin;

create temp table t_results (n serial, name text, ok boolean, detail text) on commit drop;
create temp table t_ids (name text primary key, id uuid) on commit drop;
grant all on t_results, t_ids to authenticated;
grant usage on sequence t_results_n_seq to authenticated;
create function pg_temp.check(p_name text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into t_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;
create function pg_temp.as_user(p_name text) returns void
language sql as $$ select set_config('request.jwt.claims',
  json_build_object('sub', (select id from t_ids where name = p_name), 'role', 'authenticated')::text, true) $$;
create function pg_temp.status(p_item text) returns text
language sql as $$ select status from public.whatsapp_inbox where item_id = p_item $$;
create function pg_temp.waiting(p_item text) returns boolean
language sql as $$ select exists (select 1 from public.whatsapp_inbox_waiting() w where w.item_id = p_item) $$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), 'in-qa@login-test.invalid',
       jsonb_build_object('full_name', 'Inbox QA', 'role', (select key from public.roles where level = 'manager' order by key limit 1));
insert into t_ids select 'qa', id from auth.users where email = 'in-qa@login-test.invalid';
insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), 'in-viewer@login-test.invalid',
       jsonb_build_object('full_name', 'Inbox viewer', 'role', (select key from public.roles where level = 'viewer' order by key limit 1));
insert into t_ids select 'viewer', id from auth.users where email = 'in-viewer@login-test.invalid';
insert into public.projects (name, platform, house_slug) values ('IN Test House', 'android', 'intesthouse');

-- 1. Grok's send: bug/task wait, the rest is skipped, bad rows are refused ------------------------
create temp table t_send on commit drop as
select public.whatsapp_inbox_upsert('[
  {"item_id":"IN-1","type":"bug","house":"intesthouse","title":"Push not arriving","Original Message":"AnyDesk 1695197344","Extra":"dropped"},
  {"item_id":"IN-2","type":"task","house":"intesthouse","title":"Hide a section"},
  {"item_id":"IN-3","type":"support","house":"intesthouse","title":"Remote session"},
  {"item_id":"IN-4","type":"fyi","house":"internal","title":"Internal"},
  {"item_id":"IN-5","type":"bug","house":"intesthouse","title":"Dup","status":"duplicate"},
  {"item_id":"bad id!","type":"bug","title":"x"},
  {"item_id":"IN-6","type":"bug","title":""},
  "not an object"
]'::jsonb) j;
select pg_temp.check('counts: 2 new, 3 skipped, 3 refused',
  (select (j->>'new')::int = 2 and (j->>'skipped')::int = 3 and jsonb_array_length(j->'rejected') = 3 from t_send),
  (select j::text from t_send));
select pg_temp.check('bug and task wait for review', pg_temp.waiting('IN-1') and pg_temp.waiting('IN-2'));
select pg_temp.check('support, fyi/internal and duplicate are skipped, not waiting',
  pg_temp.status('IN-3') = 'skipped' and pg_temp.status('IN-4') = 'skipped' and pg_temp.status('IN-5') = 'skipped'
  and not pg_temp.waiting('IN-3'));
select pg_temp.check('column names are normalised, unknown columns dropped',
  (select row ? 'original_message' and not row ? 'extra' and not row ? 'Original Message'
     from public.whatsapp_inbox where item_id = 'IN-1'));
select pg_temp.check('AnyDesk-like numbers removed on arrival',
  (select row->>'original_message' = 'AnyDesk [removed]' from public.whatsapp_inbox where item_id = 'IN-1'));
select pg_temp.check('refused rows say why',
  (select bool_and(x ? 'reason') from t_send, jsonb_array_elements(j->'rejected') x));

-- 2. Sent again (Grok upserts): one row, updated -------------------------------------------------
select public.whatsapp_inbox_upsert('[{"item_id":"IN-1","type":"bug","house":"intesthouse","title":"Push not arriving (still open)","status":"still open"}]');
select pg_temp.check('sent again: still one row, updated, counted',
  (select count(*) from public.whatsapp_inbox where item_id = 'IN-1') = 1
  and (select row->>'title' = 'Push not arriving (still open)' and received_count = 2 from public.whatsapp_inbox where item_id = 'IN-1'));
select public.whatsapp_inbox_upsert('[{"item_id":"IN-3","type":"bug","house":"intesthouse","title":"Turned out to be a bug"}]');
select pg_temp.check('a skipped row that becomes a bug starts waiting', pg_temp.waiting('IN-3'));

-- 3. Imported items stop waiting; dismissed ones stay dismissed ---------------------------------
select pg_temp.as_user('qa');
select public.whatsapp_import((select jsonb_agg(row) from public.whatsapp_inbox where item_id = 'IN-1'), true, false);
select pg_temp.check('imported: no longer waiting', not pg_temp.waiting('IN-1')
  and exists (select 1 from public.whatsapp_items where item_id = 'IN-1'));
select pg_temp.check('sending an imported item again reports it as already imported',
  (public.whatsapp_inbox_upsert('[{"item_id":"IN-1","type":"bug","house":"intesthouse","title":"again"}]')->>'already_imported')::int = 1
  and not pg_temp.waiting('IN-1'));
select pg_temp.check('QA dismisses a row', public.whatsapp_inbox_dismiss(array['IN-2']) = 1 and not pg_temp.waiting('IN-2'));
select public.whatsapp_inbox_upsert('[{"item_id":"IN-2","type":"task","house":"intesthouse","title":"Hide a section (again)"}]');
select pg_temp.check('a dismissed row stays dismissed when Grok sends it again', pg_temp.status('IN-2') = 'dismissed');

-- 4. Who can do what ---------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.check('QA sees the waiting rows', pg_temp.waiting('IN-3'));
do $$ begin
  perform public.whatsapp_inbox_upsert('[]'::jsonb);
  insert into t_results (name, ok) values ('a signed-in user cannot add rows (only the intake key)', false);
exception when insufficient_privilege then
  insert into t_results (name, ok) values ('a signed-in user cannot add rows (only the intake key)', true);
end $$;
select pg_temp.as_user('viewer');
select pg_temp.check('a viewer sees nothing', (select count(*) from public.whatsapp_inbox) = 0);
do $$ begin
  perform public.whatsapp_inbox_dismiss(array['IN-3']);
  insert into t_results (name, ok) values ('a viewer cannot dismiss', false);
exception when insufficient_privilege then
  insert into t_results (name, ok) values ('a viewer cannot dismiss', true);
end $$;
reset role;

-- 5. Size limit ----------------------------------------------------------------------------------------
do $$ begin
  perform public.whatsapp_inbox_upsert((select jsonb_agg(jsonb_build_object('item_id', 'IN-big-' || g, 'type', 'bug', 'title', 't'))
                                        from generate_series(1, 501) g));
  insert into t_results (name, ok) values ('more than 500 rows refused', false);
exception when invalid_parameter_value then
  insert into t_results (name, ok) values ('more than 500 rows refused', true);
end $$;

select set_config('request.jwt.claims', '', true);
do $$
declare v text;
begin
  select format('INBOX TESTS: %s passed, %s failed%s',
                count(*) filter (where ok), count(*) filter (where not ok),
                coalesce(E'\n' || string_agg(format('FAIL %s %s', name, coalesce(detail, '')), E'\n') filter (where not ok), ''))
    into v from t_results;
  raise exception '%', v;
end $$;
