-- Tests for 0046_whatsapp_import.sql. ONE transaction that always ends in an error carrying
-- the results ("WHATSAPP TESTS: n passed, m failed"), so nothing is ever committed.
-- Run: node scripts/whatsapp-import-test.mjs (live, Management API), or any psql session.
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
-- one sheet row; extra fields as a jsonb object
create function pg_temp.row(p_item text, p_type text, p_house text, p_title text, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('item_id', p_item, 'type', p_type, 'house', p_house, 'title', p_title,
                            'whatsapp_group', 'Test group', 'reporter', 'Tester', 'first_seen', '2026-10-02 10:17')
         || p_extra
$$;
create function pg_temp.imp(p_rows jsonb, p_create boolean default true, p_dry boolean default false)
returns jsonb language sql as $$ select public.whatsapp_import(p_rows, p_create, p_dry) $$;
create function pg_temp.projects_named(p_key text) returns bigint
language sql as $$ select count(*) from public.projects where name_key = public.project_name_key(p_key) $$;

-- Setup: a QA and a viewer; three projects (Android + iOS of one house, one with an abbreviation)
insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), 'wa-qa@login-test.invalid',
       jsonb_build_object('full_name', 'WA QA', 'role', (select key from public.roles where level = 'manager' order by key limit 1));
insert into t_ids select 'qa', id from auth.users where email = 'wa-qa@login-test.invalid';
insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), 'wa-viewer@login-test.invalid',
       jsonb_build_object('full_name', 'WA viewer', 'role', (select key from public.roles where level = 'viewer' order by key limit 1));
insert into t_ids select 'viewer', id from auth.users where email = 'wa-viewer@login-test.invalid';

insert into public.projects (name, platform, house_slug) values ('WA Test House', 'android', 'watesthouse');
insert into t_ids select 'house_android', id from public.projects where house_slug = 'watesthouse';
insert into public.projects (name, platform, house_group) values ('WA Test House (iOS)', 'ios', 'watesthouse');
insert into t_ids select 'house_ios', id from public.projects where name = 'WA Test House (iOS)';
insert into public.projects (name, platform) values ('Watest Capital Markets Limited (WACML)', 'android');
insert into t_ids select 'abbrev', id from public.projects where name like 'Watest Capital%';

select pg_temp.as_user('qa');

-- 1. Only QA/admin ---------------------------------------------------------------------------
select pg_temp.as_user('viewer');
do $$ begin
  perform public.whatsapp_import('[]'::jsonb, true, true);
  insert into t_results (name, ok) values ('a viewer cannot import', false);
exception when insufficient_privilege then
  insert into t_results (name, ok) values ('a viewer cannot import', true);
end $$;
select pg_temp.as_user('qa');

-- 2. Dry run writes nothing -------------------------------------------------------------------
create temp table t_plan on commit drop as
select pg_temp.imp(jsonb_build_array(
  pg_temp.row('WA-1', 'bug', 'watesthouse', 'Notifications not arriving', '{"severity":"major","category":"data / sync","area":"backend"}'),
  pg_temp.row('WA-2', 'bug', 'unknown', 'Namaa: login fails', '{"app_name":"WAnamaa"}')
), true, true) j;
select pg_temp.check('dry run: nothing written',
  not exists (select 1 from public.bugs where automation_key in ('whatsapp:WA-1', 'whatsapp:WA-2'))
  and not exists (select 1 from public.whatsapp_items where item_id like 'WA-%')
  and pg_temp.projects_named('WAnamaa') = 0);
select pg_temp.check('dry run: plans the bug in the house project and one new project',
  (select j->'rows'->0->>'action' = 'bug' and (j->'rows'->0->>'project_id')::uuid = pg_temp.id('house_android')
      and j->'rows'->1->>'how' = 'new' and jsonb_array_length(j->'created_projects') = 1 from t_plan));
grant all on t_plan to authenticated;

-- 3. A bug by house, with its fields ----------------------------------------------------------------
select pg_temp.imp(jsonb_build_array(
  pg_temp.row('WA-1', 'bug', 'watesthouse', 'Notifications not arriving',
    '{"severity":"major","category":"data / sync","area":"backend","original_message":"notification ni arahi","notes":"AnyDesk 1695197344 and 169 519 7344"}')));
select pg_temp.check('bug filed in the house''s Android project, source whatsapp',
  exists (select 1 from public.bugs b where b.automation_key = 'whatsapp:WA-1' and b.project_id = pg_temp.id('house_android')
          and b.source = 'whatsapp' and b.severity = 'major' and b.priority = 'high'));
select pg_temp.check('category matched loosely ("data / sync" = Data / Sync)',
  (select c.name from public.bugs b join public.bug_categories c on c.id = b.category_id
    where b.automation_key = 'whatsapp:WA-1') = 'Data / Sync');
select pg_temp.check('description keeps the original message and the reporter',
  (select description like '%Original message: notification ni arahi%' and description like '%Reported by Tester in WhatsApp group "Test group"%'
     from public.bugs where automation_key = 'whatsapp:WA-1'));
select pg_temp.check('AnyDesk-like numbers removed',
  (select description not like '%1695197344%' and description not like '%169 519 7344%' and description like '%[removed]%'
     from public.bugs where automation_key = 'whatsapp:WA-1'));
select pg_temp.check('dates survive the redaction', (select description like '%2026-10-02 10:17%' from public.bugs where automation_key = 'whatsapp:WA-1'));

-- 4. Never twice ---------------------------------------------------------------------------------------
create temp table t_again on commit drop as
select pg_temp.imp(jsonb_build_array(
  pg_temp.row('WA-1', 'bug', 'watesthouse', 'Notifications not arriving (still open)'),
  pg_temp.row('WA-3', 'task', 'watesthouse', 'Hide a section'),
  pg_temp.row('WA-3', 'task', 'watesthouse', 'Hide a section (repeat)'))) j;
select pg_temp.check('an imported item is skipped next time',
  (select count(*) from public.bugs where automation_key = 'whatsapp:WA-1') = 1
  and (select j->'rows'->0->>'reason' from t_again) = 'already imported');
select pg_temp.check('the same item twice in one sheet: one task',
  (select count(*) from public.whatsapp_items where item_id = 'WA-3') = 1
  and (select j->'rows'->2->>'reason' from t_again) = 'repeated in this sheet');
select pg_temp.check('a task goes to Tasks',
  exists (select 1 from public.tasks t join public.whatsapp_items w on w.task_id = t.id
          where w.item_id = 'WA-3' and t.project_id = pg_temp.id('house_android')));

-- 5. Skipped kinds -------------------------------------------------------------------------------------
create temp table t_skip on commit drop as
select pg_temp.imp(jsonb_build_array(
  pg_temp.row('WA-4', 'support', 'watesthouse', 'Remote session'),
  pg_temp.row('WA-5', 'fyi', 'watesthouse', 'Session opened'),
  pg_temp.row('WA-6', 'bug', 'internal', 'Internal chat'),
  pg_temp.row('WA-7', 'bug', 'watesthouse', 'Dup', '{"status":"duplicate"}'),
  pg_temp.row('WA-8', 'bug', 'watesthouse', 'Skipped by QA', '{"skip":true}'),
  pg_temp.row('', 'bug', 'watesthouse', 'No id'))) j;
select pg_temp.check('support, fyi, internal, duplicate, skipped and id-less rows are not filed',
  (select bool_and(x->>'action' = 'skip') from t_skip, jsonb_array_elements(j->'rows') x)
  and not exists (select 1 from public.whatsapp_items where item_id in ('WA-4','WA-5','WA-6','WA-7','WA-8')));

-- 6. Unknown project: created ONCE, also when written differently ------------------------------------
create temp table t_new on commit drop as
select pg_temp.imp(jsonb_build_array(
  pg_temp.row('WA-10', 'bug', 'unknown', 'Namaa login fails', '{"app_name":"WAnamaa"}'),
  pg_temp.row('WA-11', 'task', 'unknown', 'Namaa hide section', '{"app_name":"  wanamaa "}'),
  pg_temp.row('WA-12', 'bug', 'unknown', 'Namaa crash', '{"app_name":"WA-NAMAA"}'))) j;
select pg_temp.check('three spellings, one new project', pg_temp.projects_named('WAnamaa') = 1,
  pg_temp.projects_named('WAnamaa')::text);
select pg_temp.check('reported once as created', (select jsonb_array_length(j->'created_projects') from t_new) = 1);
select pg_temp.check('all three rows filed in it',
  (select count(distinct w.project_id) = 1 and count(*) = 3 from public.whatsapp_items w where w.item_id in ('WA-10','WA-11','WA-12'))
  and (select bool_and(w.project_id = p.id) from public.whatsapp_items w, public.projects p
        where w.item_id in ('WA-10','WA-11','WA-12') and p.name_key = public.project_name_key('WAnamaa')));
select pg_temp.check('new project is Android, says where it came from',
  (select platform = 'android' and description like 'Created automatically by the WhatsApp import%'
     from public.projects where name_key = public.project_name_key('WAnamaa')));
select pg_temp.imp(jsonb_build_array(pg_temp.row('WA-13', 'bug', 'unknown', 'Namaa again', '{"app_name":"WAnamaa"}')));
select pg_temp.check('a later import reuses it', pg_temp.projects_named('WAnamaa') = 1
  and exists (select 1 from public.whatsapp_items w join public.projects p on p.id = w.project_id
              where w.item_id = 'WA-13' and p.name_key = public.project_name_key('WAnamaa')));
select pg_temp.imp(jsonb_build_array(pg_temp.row('WA-14', 'bug', 'unknown', 'Namaa on iPhone', '{"app_name":"WAnamaa","platform":"ios"}')));
select pg_temp.check('an iOS row of an app with only an Android project: that project, nothing created',
  pg_temp.projects_named('WAnamaa (iOS)') = 0
  and (select p.name from public.whatsapp_items w join public.projects p on p.id = w.project_id where w.item_id = 'WA-14') = 'WAnamaa');
select pg_temp.imp(jsonb_build_array(pg_temp.row('WA-15', 'bug', 'unknown', 'iOS-only app', '{"app_name":"WAiosonly","platform":"ios"}')));
select pg_temp.imp(jsonb_build_array(pg_temp.row('WA-16', 'bug', 'unknown', 'iOS-only app again', '{"app_name":"WAiosonly","platform":"ios"}')));
select pg_temp.check('a new iOS app: "<name> (iOS)" created once and reused',
  (select count(*) from public.projects where name = 'WAiosonly (iOS)' and platform = 'ios') = 1
  and (select count(distinct project_id) from public.whatsapp_items where item_id in ('WA-15', 'WA-16')) = 1);

-- 7. Existing projects are found, not re-created -------------------------------------------------------------
select pg_temp.imp(jsonb_build_array(
  pg_temp.row('WA-20', 'bug', 'unknown', 'By abbreviation', '{"app_name":"WACML"}'),
  pg_temp.row('WA-21', 'bug', 'unknown', 'By exact name', '{"app_name":"wa test house"}'),
  pg_temp.row('WA-22', 'bug', 'watesthouse', 'iOS row of the house', '{"platform":"ios"}'),
  pg_temp.row('WA-23', 'bug', 'unknown', 'Name only on Android, row says iOS', '{"app_name":"Watest Capital Markets Limited","platform":"ios"}')));
select pg_temp.check('found by its bracket abbreviation',
  (select project_id from public.whatsapp_items where item_id = 'WA-20') = pg_temp.id('abbrev'));
select pg_temp.check('found by name, Android preferred when the row has no platform',
  (select project_id from public.whatsapp_items where item_id = 'WA-21') = pg_temp.id('house_android'));
select pg_temp.check('an iOS row goes to the house''s iOS project',
  (select project_id from public.whatsapp_items where item_id = 'WA-22') = pg_temp.id('house_ios'));
select pg_temp.check('no iOS project yet: the Android one, nothing created',
  (select project_id from public.whatsapp_items where item_id = 'WA-23') = pg_temp.id('abbrev')
  and pg_temp.projects_named('Watest Capital Markets Limited (iOS)') = 0);

-- 8. Creating turned off, chosen project, nothing to name it by -----------------------------------------------
create temp table t_off on commit drop as
select pg_temp.imp(jsonb_build_array(
  pg_temp.row('WA-30', 'bug', 'unknown', 'Unknown app', '{"app_name":"WAnewapp"}'),
  pg_temp.row('WA-31', 'bug', 'unknown', 'No name at all'),
  pg_temp.row('WA-32', 'bug', 'unknown', 'QA chose the project', jsonb_build_object('project_id', pg_temp.id('abbrev')))), false) j;
select pg_temp.check('creating off: held back with the app''s name',
  pg_temp.projects_named('WAnewapp') = 0 and (select j->'rows'->0->>'reason' from t_off) = 'no project for "WAnewapp"');
select pg_temp.check('no house or app name: held back', (select j->'rows'->1->>'reason' from t_off) = 'no house or app name');
select pg_temp.check('a project chosen in the preview is used',
  (select project_id from public.whatsapp_items where item_id = 'WA-32') = pg_temp.id('abbrev'));

-- 9. The database itself refuses a duplicate project ---------------------------------------------------------
do $$ begin
  insert into public.projects (name, platform) values ('wa  test-house', 'android');
  insert into t_results (name, ok) values ('same name + platform refused (any spelling)', false);
exception when unique_violation then
  insert into t_results (name, ok) values ('same name + platform refused (any spelling)', true);
end $$;
do $$ begin
  insert into public.projects (name, platform) values ('WA Test House', 'ios');
  insert into t_results (name, ok) values ('same name on the other platform allowed', true);
exception when unique_violation then
  insert into t_results (name, ok) values ('same name on the other platform allowed', false);
end $$;

-- 10. Runs under RLS as a real QA session -------------------------------------------------------------------
set local role authenticated;
select pg_temp.imp(jsonb_build_array(
  pg_temp.row('WA-40', 'bug', 'unknown', 'RLS bug', '{"app_name":"WArlsapp"}'),
  pg_temp.row('WA-41', 'task', 'watesthouse', 'RLS task')));
reset role;
select pg_temp.check('as a signed-in QA: project, bug and task created',
  pg_temp.projects_named('WArlsapp') = 1
  and (select count(*) from public.whatsapp_items where item_id in ('WA-40', 'WA-41')) = 2);

select set_config('request.jwt.claims', '', true);
do $$
declare v text;
begin
  select format('WHATSAPP TESTS: %s passed, %s failed%s',
                count(*) filter (where ok), count(*) filter (where not ok),
                coalesce(E'\n' || string_agg(format('FAIL %s %s', name, coalesce(detail, '')), E'\n') filter (where not ok), ''))
    into v from t_results;
  raise exception '%', v;
end $$;
