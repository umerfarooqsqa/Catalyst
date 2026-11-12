-- Tests for 0050_whatsapp_group_houses.sql. ONE transaction that always ends in an error carrying
-- the results ("GROUP TESTS: n passed, m failed"), so nothing is ever committed.
-- Run: node scripts/whatsapp-import-test.mjs (live, Management API), or any psql session.
-- Made-up project and group names, so nothing collides with real ones on the live database.
begin;

update private.settings set value = '' where key = 'email_dispatch_url';
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
create function pg_temp.project_of(p_item text) returns uuid
language sql as $$ select project_id from public.whatsapp_items where item_id = p_item $$;
create function pg_temp.waiting(p_item text) returns boolean
language sql as $$ select exists (select 1 from public.whatsapp_inbox_waiting() w where w.item_id = p_item) $$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), 'gh-qa@login-test.invalid',
       jsonb_build_object('full_name', 'Group QA', 'role', (select key from public.roles where level = 'manager' order by key limit 1));
insert into t_ids select 'qa', id from auth.users where email = 'gh-qa@login-test.invalid';
insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), 'gh-dev@login-test.invalid',
       jsonb_build_object('full_name', 'Group Dev', 'role', (select key from public.roles where level = 'contributor' order by key limit 1));
insert into t_ids select 'dev', id from auth.users where email = 'gh-dev@login-test.invalid';

insert into public.projects (name, platform, house_slug, house_group) values ('GHX Orvanta', 'android', 'ghxorvanta', 'ghxorvanta');
insert into t_ids select 'orv', id from public.projects where house_slug = 'ghxorvanta';
insert into public.projects (name, platform, house_group) values ('GHX Orvanta (iOS)', 'ios', 'ghxorvanta');
insert into t_ids select 'orv_ios', id from public.projects where name = 'GHX Orvanta (iOS)';
insert into public.projects (name, platform, house_slug, house_group) values ('GHY Pellmar', 'android', 'ghypellmar', 'ghypellmar');
insert into t_ids select 'pel', id from public.projects where house_slug = 'ghypellmar';

-- ---- setting a group's house ---------------------------------------------------------------------
select pg_temp.as_user('dev');
do $$ begin
  perform public.whatsapp_set_group('GH Orvanta Group', (select id from t_ids where name = 'orv'), false);
  insert into t_results (name, ok) values ('a developer cannot set a group''s house', false);
exception when insufficient_privilege then
  insert into t_results (name, ok) values ('a developer cannot set a group''s house', true);
end $$;

select pg_temp.as_user('qa');
select public.whatsapp_set_group('GH  Orvanta-Group', pg_temp.id('orv'), false);
select pg_temp.check('QA sets a group''s house; the key ignores case, spaces and punctuation',
  (select project_id = pg_temp.id('orv') and not mixed and updated_by = pg_temp.id('qa')
     from public.whatsapp_groups where group_key = public.project_name_key('gh orvanta group')));
select public.whatsapp_set_group('GH Mixed Group', null, true);
select pg_temp.check('a group can be marked mixed (no project)',
  (select mixed and project_id is null from public.whatsapp_groups where group_key = public.project_name_key('GH Mixed Group')));
do $$ begin
  perform public.whatsapp_set_group('GH Mixed Group', (select id from t_ids where name = 'orv'), true);
  insert into t_results (name, ok) values ('a group cannot have a house and be mixed', false);
exception when others then
  insert into t_results (name, ok) values ('a group cannot have a house and be mixed', sqlstate = '22023');
end $$;

set local role authenticated;
do $$ begin
  insert into public.whatsapp_groups (group_key, group_name, project_id) values ('ghdirect', 'GH direct', null);
  insert into t_results (name, ok) values ('nobody writes the groups table directly', false);
exception when insufficient_privilege then
  insert into t_results (name, ok) values ('nobody writes the groups table directly', true);
end $$;
select pg_temp.check('QA reads the groups (name stored with single spaces)',
  exists (select 1 from public.whatsapp_groups where group_name = 'GH Orvanta-Group'));
reset role;

-- ---- Grok sends; the automatic import uses the groups --------------------------------------------
select set_config('request.jwt.claims', '', true);
select public.whatsapp_inbox_upsert('[
  {"item_id":"GH-1","type":"bug","house":"unknown","app_name":"Ghnosuchapp","whatsapp_group":"GH Orvanta Group","title":"No house, group known"},
  {"item_id":"GH-2","type":"bug","house":"unknown","whatsapp_group":"gh orvanta group","platform":"ios","title":"iOS row from the group"},
  {"item_id":"GH-3","type":"task","house":"ghypellmar","whatsapp_group":"GH Orvanta Group","title":"House named: house wins"},
  {"item_id":"GH-4","type":"bug","house":"unknown","app_name":"Ghnosuchapp","whatsapp_group":"GH Mixed Group","title":"Mixed group, unclear"},
  {"item_id":"GH-5","type":"bug","house":"ghypellmar","whatsapp_group":"GH Mixed Group","title":"Mixed group, house named"},
  {"item_id":"GH-6","type":"bug","house":"unknown","app_name":"Ghnosuchapp","whatsapp_group":"GH Unset Group","title":"Group not set"}
]');
create temp table t_auto on commit drop as select public.whatsapp_auto_import() j;

select pg_temp.check('a row with no house is filed in its group''s house',
  pg_temp.project_of('GH-1') = pg_temp.id('orv'));
select pg_temp.check('an iOS row from the group goes to the house''s iOS project',
  pg_temp.project_of('GH-2') = pg_temp.id('orv_ios'));
select pg_temp.check('the row''s own house beats the group''s house',
  pg_temp.project_of('GH-3') = pg_temp.id('pel'));
select pg_temp.check('mixed group: an unclear row keeps waiting, a row naming its house is filed',
  pg_temp.project_of('GH-4') is null and pg_temp.waiting('GH-4') and pg_temp.project_of('GH-5') = pg_temp.id('pel'));
select pg_temp.check('a group with no house set changes nothing: the row keeps waiting',
  pg_temp.project_of('GH-6') is null and pg_temp.waiting('GH-6'));
select pg_temp.check('the automatic import reports the group''s house as the project',
  (select x->>'project' = 'GHX Orvanta' and x->>'action' = 'bug'
     from t_auto, jsonb_array_elements(j->'rows') x where x->>'item_id' = 'GH-1'),
  (select j::text from t_auto));
select pg_temp.check('the inbox row itself is unchanged (no project_id stored)',
  (select not (row ? 'project_id') and not (row ? 'via_group') from public.whatsapp_inbox where item_id = 'GH-1'));

-- ---- QA on the Bug Library: set the waiting group, preview, choose per message ----------------
select pg_temp.as_user('qa');
select public.whatsapp_set_group('GH Unset Group', pg_temp.id('pel'), false);
create temp table t_prev on commit drop as
  select public.whatsapp_import((select jsonb_agg(row) from public.whatsapp_inbox where item_id in ('GH-4', 'GH-6')), false, true) j;
select pg_temp.check('preview: the newly set group''s row shows how = group, the mixed one still needs a house',
  (select x->>'how' = 'group' and x->>'project_name' = 'GHY Pellmar' and x->>'action' = 'bug'
     from t_prev, jsonb_array_elements(j->'rows') x where x->>'item_id' = 'GH-6')
  and (select x->>'action' = 'skip' from t_prev, jsonb_array_elements(j->'rows') x where x->>'item_id' = 'GH-4'),
  (select j::text from t_prev));
select public.whatsapp_import(
  (select jsonb_agg(case when item_id = 'GH-4' then row || jsonb_build_object('project_id', pg_temp.id('orv')) else row end)
     from public.whatsapp_inbox where item_id in ('GH-4', 'GH-6')),
  false, false);
select pg_temp.check('import: the group''s row and the message QA chose are filed',
  pg_temp.project_of('GH-6') = pg_temp.id('pel') and pg_temp.project_of('GH-4') = pg_temp.id('orv'));

select public.whatsapp_inbox_upsert('[{"item_id":"GH-7","type":"bug","house":"unknown","whatsapp_group":"GH Orvanta Group","title":"QA override"}]');
create temp table t_pick on commit drop as
  select public.whatsapp_import((select jsonb_agg(row || jsonb_build_object('project_id', pg_temp.id('pel')))
                                   from public.whatsapp_inbox where item_id = 'GH-7'), false, true) j;
select pg_temp.check('QA''s choice for a message beats its group''s house (how = chosen)',
  (select x->>'how' = 'chosen' and x->>'project_name' = 'GHY Pellmar' from t_pick, jsonb_array_elements(j->'rows') x));

select public.whatsapp_set_group('GH Orvanta Group', null, false);
select pg_temp.check('clearing a group removes it; its rows wait again',
  not exists (select 1 from public.whatsapp_groups where group_key = public.project_name_key('GH Orvanta Group'))
  and (select x->>'action' = 'skip' from jsonb_array_elements(
         public.whatsapp_import((select jsonb_agg(row) from public.whatsapp_inbox where item_id = 'GH-7'), false, true)->'rows') x));

-- ---- signed-in users can't use the internals ---------------------------------------------------
set local role authenticated;
do $$ begin
  perform public.whatsapp_apply_groups('[]'::jsonb);
  insert into t_results (name, ok) values ('a signed-in user cannot call the group helpers', false);
exception when insufficient_privilege then
  insert into t_results (name, ok) values ('a signed-in user cannot call the group helpers', true);
end $$;
reset role;

select set_config('request.jwt.claims', '', true);
do $$
declare v text;
begin
  select format('GROUP TESTS: %s passed, %s failed%s',
                count(*) filter (where ok), count(*) filter (where not ok),
                coalesce(E'\n' || string_agg(format('FAIL %s %s', name, coalesce(detail, '')), E'\n') filter (where not ok), ''))
    into v from t_results;
  raise exception '%', v;
end $$;
