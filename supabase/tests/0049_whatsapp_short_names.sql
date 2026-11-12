-- Tests for 0049_whatsapp_short_names.sql. ONE transaction that always ends in an error carrying
-- the results ("SHORT NAME TESTS: n passed, m failed"), so nothing is ever committed.
-- Run: node scripts/whatsapp-import-test.mjs (live, Management API), or any psql session.
-- The test projects have made-up names ("Zorvexa", "Kelvorn"...) so they can't collide with real
-- projects on the live database, where name matching sees every project.
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
create function pg_temp.find_id(p_house text, p_app text, p_plat text default null) returns uuid
language sql as $$ select f.project_id from public.whatsapp_find_project(p_house, p_app, p_plat) f $$;
create function pg_temp.find_how(p_house text, p_app text, p_plat text default null) returns text
language sql as $$ select f.how from public.whatsapp_find_project(p_house, p_app, p_plat) f $$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), 'sn-qa@login-test.invalid',
       jsonb_build_object('full_name', 'Short name QA', 'role', (select key from public.roles where level = 'manager' order by key limit 1));
insert into t_ids select 'qa', id from auth.users where email = 'sn-qa@login-test.invalid';

-- like "MRA Wiqaya" / "MRA D-Trade": a house, its iOS sibling, and a second house
insert into public.projects (name, platform, house_slug, house_group) values ('SNX Zorvexa', 'android', 'snxzorvexa', 'snxzorvexa');
insert into t_ids select 'zor', id from public.projects where house_slug = 'snxzorvexa';
insert into public.projects (name, platform, house_group) values ('SNX Zorvexa (iOS)', 'ios', 'snxzorvexa');
insert into t_ids select 'zor_ios', id from public.projects where name = 'SNX Zorvexa (iOS)';
insert into public.projects (name, platform, house_slug, house_group) values ('SNX Bri-Mvolt', 'android', 'snxbrimvolt', 'snxbrimvolt');
insert into t_ids select 'bri', id from public.projects where house_slug = 'snxbrimvolt';
-- two projects ending in the same word
insert into public.projects (name, platform) values ('SNA Kelvorn', 'android'), ('SNB Kelvorn', 'android');
insert into t_ids select 'kel_a', id from public.projects where name = 'SNA Kelvorn';
insert into t_ids select 'kel_b', id from public.projects where name = 'SNB Kelvorn';
-- generic and short words never match on their own; a middle word can
insert into public.projects (name, platform) values ('SNX Qwyth Securities', 'android'), ('SNX Plom Vyx', 'android');
insert into t_ids select 'sec', id from public.projects where name = 'SNX Qwyth Securities';
insert into t_ids select 'vyx', id from public.projects where name = 'SNX Plom Vyx';
-- like "Habib": the last word of one project and a middle word of another
insert into public.projects (name, platform) values ('SNP Morlune', 'android'), ('SNQ Morlune Metro', 'android');

-- ---- the helpers --------------------------------------------------------------------------------
select pg_temp.check('name parts: split on / , & + | and; hyphens kept',
  public.whatsapp_name_parts('D-Trade / Wiqaya') = array['D-Trade', 'Wiqaya']
  and public.whatsapp_name_parts('A, B & C + D | E and F') = array['A', 'B', 'C', 'D', 'E', 'F']
  and public.whatsapp_name_parts('Brandon Trade') = array['Brandon Trade']      -- "and" only as a word
  and public.whatsapp_name_parts(' / ') = '{}'::text[],
  public.whatsapp_name_parts('A, B & C + D | E and F')::text);
select pg_temp.check('short keys: runs of whole words, no brackets, no generic or short runs, not the whole name',
  public.project_short_keys('MRA D-Trade (iOS)') = array['dtrade']
  and public.project_short_keys('HMFS Insta Trade') = array['hmfs', 'hmfsinsta', 'insta', 'instatrade']
  and public.project_short_keys('SNX Plom Vyx') = array['plom', 'plomvyx', 'snxplom']
  and public.project_short_keys('ABC Securities Limited') = array['abcsecurities']   -- generic-only runs dropped
  and public.project_short_keys('Wiqaya') = '{}'::text[],
  public.project_short_keys('HMFS Insta Trade')::text || ' ' || public.project_short_keys('SNX Plom Vyx')::text);

-- ---- matching ------------------------------------------------------------------------------------
select pg_temp.check('a short name finds the project ("Zorvexa" -> SNX Zorvexa, Android first)',
  pg_temp.find_id('unknown', 'Zorvexa') = pg_temp.id('zor') and pg_temp.find_how('unknown', 'Zorvexa') = 'name');
select pg_temp.check('an iOS row with a short name finds the iOS project',
  pg_temp.find_id('unknown', 'zorvexa', 'ios') = pg_temp.id('zor_ios'));
select pg_temp.check('a hyphenated short name finds the project ("Bri-Mvolt", "bri mvolt")',
  pg_temp.find_id('unknown', 'Bri-Mvolt') = pg_temp.id('bri') and pg_temp.find_id(null, 'bri mvolt') = pg_temp.id('bri')
  and pg_temp.find_id('unknown', 'Plom Vyx') = pg_temp.id('vyx'));
select pg_temp.check('a short name in the house column finds the project',
  pg_temp.find_id('Zorvexa', null) = pg_temp.id('zor'));
select pg_temp.check('parts naming the same project file there ("Zorvexa / SNX Zorvexa")',
  pg_temp.find_id('unknown', 'Zorvexa / SNX Zorvexa') = pg_temp.id('zor'));
select pg_temp.check('parts naming two projects are ambiguous ("Zorvexa / Bri-Mvolt")',
  pg_temp.find_how('unknown', 'Zorvexa / Bri-Mvolt') = 'ambiguous' and pg_temp.find_id('unknown', 'Zorvexa / Bri-Mvolt') is null);
select pg_temp.check('a short name shared by two projects is ambiguous ("Kelvorn")',
  pg_temp.find_how('unknown', 'Kelvorn') = 'ambiguous');
select pg_temp.check('a word in two projects'' names is ambiguous, wherever it comes ("Morlune")',
  pg_temp.find_how('unknown', 'Morlune') = 'ambiguous');
select pg_temp.check('a middle word unique to one project finds it ("Qwyth")',
  pg_temp.find_id('unknown', 'Qwyth') = pg_temp.id('sec'));
select pg_temp.check('a known part with an unknown part is ambiguous, not guessed',
  pg_temp.find_how('unknown', 'Zorvexa / Snxnosuchapp') = 'ambiguous');
select pg_temp.check('no part matching anything stays "none"',
  pg_temp.find_how('unknown', 'Snxnosuch / Snxneither') = 'none');
select pg_temp.check('generic or short words never match on their own',
  pg_temp.find_id('unknown', 'Securities') is distinct from pg_temp.id('sec')
  and pg_temp.find_id('unknown', 'Vyx') is distinct from pg_temp.id('vyx'));
select pg_temp.check('unchanged: house first, then the whole name exactly',
  pg_temp.find_how('snxbrimvolt', 'Zorvexa') = 'house' and pg_temp.find_id('snxbrimvolt', 'Zorvexa') = pg_temp.id('bri')
  and pg_temp.find_id('unknown', 'SNX Qwyth Securities') = pg_temp.id('sec'));

-- ---- Grok sends; the automatic import files what it can and explains the rest -------------------
select public.whatsapp_inbox_upsert('[
  {"item_id":"SN-1","type":"bug","house":"unknown","app_name":"Zorvexa","title":"Short name bug"},
  {"item_id":"SN-2","type":"bug","house":"unknown","app_name":"Zorvexa / Bri-Mvolt","title":"jnlp links fail in both"},
  {"item_id":"SN-3","type":"task","house":"unknown","app_name":"Kelvorn","title":"Shared short name"},
  {"item_id":"SN-4","type":"bug","house":"snxzorvexa","title":"Split row, first house"},
  {"item_id":"SN-5","type":"bug","house":"snxbrimvolt","title":"Split row, second house"},
  {"item_id":"SN-6","type":"bug","house":"unknown","app_name":"Zorvexa","platform":"ios","title":"iOS short name bug"}
]');
create temp table t_auto on commit drop as select public.whatsapp_auto_import() j;
create function pg_temp.auto_reason(p_item text) returns text
language sql as $$ select x->>'reason' from t_auto, jsonb_array_elements(j->'rows') x where x->>'item_id' = p_item $$;

select pg_temp.check('short name row filed at once in its project',
  pg_temp.project_of('SN-1') = pg_temp.id('zor'));
select pg_temp.check('iOS short name row filed in the iOS project',
  pg_temp.project_of('SN-6') = pg_temp.id('zor_ios'));
select pg_temp.check('two-app row held, its reason names both projects',
  pg_temp.project_of('SN-2') is null
  and pg_temp.auto_reason('SN-2') = 'more than one project matches ("Zorvexa" -> SNX Zorvexa; "Bri-Mvolt" -> SNX Bri-Mvolt): send one row per house, or choose one',
  pg_temp.auto_reason('SN-2'));
select pg_temp.check('shared short name held, its reason lists the candidates',
  pg_temp.project_of('SN-3') is null
  and pg_temp.auto_reason('SN-3') = 'more than one project matches ("Kelvorn" -> SNA Kelvorn, SNB Kelvorn): choose one',
  pg_temp.auto_reason('SN-3'));
select pg_temp.check('the same issue sent as one row per house files both',
  pg_temp.project_of('SN-4') = pg_temp.id('zor') and pg_temp.project_of('SN-5') = pg_temp.id('bri'));

-- ---- QA sees the same reason on the import page and can still choose ---------------------------
select pg_temp.as_user('qa');
create temp table t_prev on commit drop as
  select public.whatsapp_import((select jsonb_agg(row) from public.whatsapp_inbox where item_id = 'SN-2'), true, true) j;
select pg_temp.check('import preview: held as ambiguous (picker shown), same explained reason, no project created',
  (select x->>'how' = 'ambiguous' and x->>'action' = 'skip'
          and x->>'reason' like 'more than one project matches ("Zorvexa" -> SNX Zorvexa; %'
     from t_prev, jsonb_array_elements(j->'rows') x)
  and (select jsonb_array_length(j->'created_projects') = 0 from t_prev),
  (select j::text from t_prev));
select public.whatsapp_import(
  (select jsonb_agg(row || jsonb_build_object('project_id', pg_temp.id('bri'))) from public.whatsapp_inbox where item_id = 'SN-2'),
  true, false);
select pg_temp.check('QA chooses a project for the held row: filed there',
  pg_temp.project_of('SN-2') = pg_temp.id('bri'));

-- ---- signed-in users can't use the internals -----------------------------------------------------
set local role authenticated;
do $$ begin
  perform public.whatsapp_explain_matches('[]'::jsonb, '{"rows": []}'::jsonb);
  insert into t_results (name, ok) values ('a signed-in user cannot call the explanation helper', false);
exception when insufficient_privilege then
  insert into t_results (name, ok) values ('a signed-in user cannot call the explanation helper', true);
end $$;
reset role;

select set_config('request.jwt.claims', '', true);
do $$
declare v text;
begin
  select format('SHORT NAME TESTS: %s passed, %s failed%s',
                count(*) filter (where ok), count(*) filter (where not ok),
                coalesce(E'\n' || string_agg(format('FAIL %s %s', name, coalesce(detail, '')), E'\n') filter (where not ok), ''))
    into v from t_results;
  raise exception '%', v;
end $$;
