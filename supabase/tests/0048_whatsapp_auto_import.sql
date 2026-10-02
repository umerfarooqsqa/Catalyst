-- Tests for 0048_whatsapp_auto_import.sql. ONE transaction that always ends in an error carrying
-- the results ("AUTO TESTS: n passed, m failed"), so nothing is ever committed.
begin;

update private.settings set value = '' where key = 'email_dispatch_url';
create temp table t_results (n serial, name text, ok boolean, detail text) on commit drop;
create temp table t_ids (name text primary key, id uuid) on commit drop;
grant all on t_results, t_ids to authenticated;
grant usage on sequence t_results_n_seq to authenticated;
create function pg_temp.check(p_name text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into t_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;
create function pg_temp.as_user(p_name text) returns void
language sql as $$ select set_config('request.jwt.claims',
  json_build_object('sub', (select id from t_ids where name = p_name), 'role', 'authenticated')::text, true) $$;
create function pg_temp.filed(p_item text) returns boolean
language sql as $$ select exists (select 1 from public.whatsapp_items where item_id = p_item) $$;
create function pg_temp.waiting(p_item text) returns boolean
language sql as $$ select exists (select 1 from public.whatsapp_inbox_waiting() w where w.item_id = p_item) $$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), 'au-qa@login-test.invalid',
       jsonb_build_object('full_name', 'Auto QA', 'role', (select key from public.roles where level = 'manager' order by key limit 1));
insert into t_ids select 'qa', id from auth.users where email = 'au-qa@login-test.invalid';
insert into public.projects (name, platform, house_slug) values ('AU Test House', 'android', 'autesthouse');
insert into t_ids select 'house', id from public.projects where house_slug = 'autesthouse';
insert into public.projects (name, platform) values ('AU Named App', 'android');
insert into t_ids select 'named', id from public.projects where name = 'AU Named App';

-- Grok sends; the route then runs the automatic import (as the service role: no user)
select public.whatsapp_inbox_upsert('[
  {"item_id":"AU-1","type":"bug","house":"autesthouse","title":"Known house bug","severity":"major","category":"Crash / Error"},
  {"item_id":"AU-2","type":"task","house":"autesthouse","title":"Known house task"},
  {"item_id":"AU-3","type":"bug","house":"unknown","app_name":"AU named app","title":"Found by name"},
  {"item_id":"AU-4","type":"bug","house":"unknown","app_name":"AUbrandnew","title":"Unknown app"},
  {"item_id":"AU-5","type":"bug","house":"unknown","title":"No house, no app"},
  {"item_id":"AU-6","type":"fyi","house":"autesthouse","title":"FYI"},
  {"item_id":"AU-7","type":"bug","house":"autesthouse","title":"QA dismissed this before"}
]');
update public.whatsapp_inbox set status = 'dismissed' where item_id = 'AU-7';
create temp table t_auto on commit drop as select public.whatsapp_auto_import() j;

select pg_temp.check('known house: bug and task filed at once',
  pg_temp.filed('AU-1') and pg_temp.filed('AU-2')
  and exists (select 1 from public.bugs where automation_key = 'whatsapp:AU-1' and project_id = (select id from t_ids where name = 'house'))
  and exists (select 1 from public.tasks t join public.whatsapp_items w on w.task_id = t.id where w.item_id = 'AU-2'));
select pg_temp.check('found by name: filed at once', pg_temp.filed('AU-3')
  and (select project_id from public.whatsapp_items where item_id = 'AU-3') = (select id from t_ids where name = 'named'));
select pg_temp.check('unknown app: held for review, no project created',
  not pg_temp.filed('AU-4') and pg_temp.waiting('AU-4')
  and not exists (select 1 from public.projects where name_key = public.project_name_key('AUbrandnew')));
select pg_temp.check('no house or app name: held for review', not pg_temp.filed('AU-5') and pg_temp.waiting('AU-5'));
select pg_temp.check('fyi and dismissed rows are not filed', not pg_temp.filed('AU-6') and not pg_temp.filed('AU-7'));
-- (count only this test's rows: on the live database real rows may be waiting too)
select pg_temp.check('reported per row: 2 bugs, 1 task, 2 held',
  (select count(*) filter (where x->>'action' = 'bug') = 2 and count(*) filter (where x->>'action' = 'task') = 1
          and count(*) filter (where x->>'action' = 'skip' and x->>'reason' <> 'already imported') = 2
     from t_auto, jsonb_array_elements(j->'rows') x where x->>'item_id' like 'AU-%'),
  (select j::text from t_auto));
select pg_temp.check('automatic bugs have no creator (Grok), source whatsapp',
  (select created_by is null and source = 'whatsapp' from public.bugs where automation_key = 'whatsapp:AU-1'));

-- Sent again + auto import again: nothing filed twice
select public.whatsapp_inbox_upsert('[{"item_id":"AU-1","type":"bug","house":"autesthouse","title":"Known house bug (still open)"}]');
select public.whatsapp_auto_import();
select pg_temp.check('a resend never files a second bug',
  (select count(*) from public.bugs where automation_key = 'whatsapp:AU-1') = 1);

-- QA handles a held row on the import page, creating its project
select pg_temp.as_user('qa');
select public.whatsapp_import((select jsonb_agg(row) from public.whatsapp_inbox where item_id = 'AU-4'), true, false);
select pg_temp.check('QA imports the held row: project created once, row filed',
  pg_temp.filed('AU-4') and not pg_temp.waiting('AU-4')
  and (select count(*) from public.projects where name_key = public.project_name_key('AUbrandnew')) = 1);
select pg_temp.check('QA import records who imported',
  (select imported_by from public.whatsapp_items where item_id = 'AU-4') = (select id from t_ids where name = 'qa'));

-- Signed-in users can't use the internals
set local role authenticated;
do $$ begin
  perform public.whatsapp_auto_import();
  insert into t_results (name, ok) values ('a signed-in user cannot run the automatic import', false);
exception when insufficient_privilege then
  insert into t_results (name, ok) values ('a signed-in user cannot run the automatic import', true);
end $$;
do $$ begin
  perform public.whatsapp_import_core('[]'::jsonb, true, false);
  insert into t_results (name, ok) values ('a signed-in user cannot call the import core', false);
exception when insufficient_privilege then
  insert into t_results (name, ok) values ('a signed-in user cannot call the import core', true);
end $$;
reset role;

select set_config('request.jwt.claims', '', true);
do $$
declare v text;
begin
  select format('AUTO TESTS: %s passed, %s failed%s',
                count(*) filter (where ok), count(*) filter (where not ok),
                coalesce(E'\n' || string_agg(format('FAIL %s %s', name, coalesce(detail, '')), E'\n') filter (where not ok), ''))
    into v from t_results;
  raise exception '%', v;
end $$;
