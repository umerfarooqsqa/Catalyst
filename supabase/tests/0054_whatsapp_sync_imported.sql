-- Tests for 0054_whatsapp_sync_imported.sql. ONE transaction that always ends in an error carrying
-- the results ("SYNC TESTS: n passed, m failed"), so nothing is ever committed.
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
create function pg_temp.bug_of(p_item text) returns uuid
language sql as $$ select bug_id from public.whatsapp_items where item_id = p_item $$;
create function pg_temp.task_of(p_item text) returns uuid
language sql as $$ select task_id from public.whatsapp_items where item_id = p_item $$;
create function pg_temp.comments_on(p_item text) returns bigint
language sql as $$ select count(*) from public.comments c, public.whatsapp_items w
                   where w.item_id = p_item and (c.bug_id = w.bug_id or c.task_id = w.task_id) $$;
-- one Grok row for the test house, with extra fields
create function pg_temp.r(p_item text, p_type text, p_extra jsonb default '{}') returns jsonb
language sql as $$ select jsonb_build_object('item_id', p_item, 'type', p_type, 'house', 'synctesthouse',
  'title', 'Sync test ' || p_item, 'description', 'Original text', 'severity', 'minor', 'status', 'new',
  'notes', '', 'last_seen', '2026-10-07 10:00') || p_extra $$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), 'sy-dev@login-test.invalid',
       jsonb_build_object('full_name', 'Sync Dev', 'role', (select key from public.roles where level = 'contributor' order by key limit 1));
insert into t_ids select 'dev', id from auth.users where email = 'sy-dev@login-test.invalid';
insert into public.projects (name, platform, house_slug) values ('Sync Test House', 'android', 'synctesthouse');

-- first send: both items are filed by the automatic import
select public.whatsapp_inbox_upsert(jsonb_build_array(pg_temp.r('SY-1', 'bug'), pg_temp.r('SY-2', 'task')));
select public.whatsapp_auto_import();
update public.bugs set assignee_id = pg_temp.id('dev') where id = pg_temp.bug_of('SY-1');
select pg_temp.check('setup: bug and task filed', pg_temp.bug_of('SY-1') is not null and pg_temp.task_of('SY-2') is not null);

-- an identical re-send changes nothing
create temp table t_same on commit drop as
  select public.whatsapp_inbox_upsert(jsonb_build_array(pg_temp.r('SY-1', 'bug'))) j;
select pg_temp.check('identical re-send: already_imported, no comment',
  (select (j->>'already_imported')::int = 1 and (j->>'updated')::int = 0 from t_same) and pg_temp.comments_on('SY-1') = 0,
  (select j::text from t_same));

-- only last_seen changed (the Bot re-sends the whole sheet): still nothing
create temp table t_seen on commit drop as
  select public.whatsapp_inbox_upsert(jsonb_build_array(pg_temp.r('SY-1', 'bug', '{"last_seen":"2026-10-07 11:30"}'))) j;
select pg_temp.check('only last_seen changed: already_imported, no comment, nobody notified',
  (select (j->>'already_imported')::int = 1 from t_seen) and pg_temp.comments_on('SY-1') = 0
  and not exists (select 1 from public.notifications where user_id = pg_temp.id('dev') and type = 'comment'));

-- a real follow-up: status, notes and severity change
create temp table t_follow on commit drop as
  select public.whatsapp_inbox_upsert(jsonb_build_array(pg_temp.r('SY-1', 'bug',
    '{"status":"still open","notes":"Mobin is checking","severity":"major","last_seen":"2026-10-07 12:15"}'))) j;
select pg_temp.check('follow-up: counted as updated, one comment',
  (select (j->>'updated')::int = 1 and (j->>'already_imported')::int = 0 from t_follow) and pg_temp.comments_on('SY-1') = 1,
  (select j::text from t_follow));
select pg_temp.check('the comment lists the changes and when it was last seen, and has no author',
  (select author_id is null
          and content like 'WhatsApp update (SY-1):%'
          and content like '%Status: new → still open%'
          and content like '%Severity: minor → major%'
          and content like '%Notes: Mobin is checking%'
          and content like '%Last seen in WhatsApp: 2026-10-07 12:15%'
     from public.comments where bug_id = pg_temp.bug_of('SY-1')),
  (select content from public.comments where bug_id = pg_temp.bug_of('SY-1')));
select pg_temp.check('the bug''s own severity and status are left to QA',
  (select severity = 'minor' and status = 'open' from public.bugs where id = pg_temp.bug_of('SY-1')));
select pg_temp.check('the assignee is notified of the comment',
  exists (select 1 from public.notifications where user_id = pg_temp.id('dev') and type = 'comment'
           and related_bug_id = pg_temp.bug_of('SY-1')));

-- same values in another case / with spaces: not a change
create temp table t_case on commit drop as
  select public.whatsapp_inbox_upsert(jsonb_build_array(pg_temp.r('SY-1', 'bug',
    '{"status":" Still Open ","notes":"Mobin is checking ","severity":"MAJOR","last_seen":"2026-10-07 12:40"}'))) j;
select pg_temp.check('case and spaces alone are not a change', pg_temp.comments_on('SY-1') = 1,
  (select j::text from t_case));

-- a task follow-up
select public.whatsapp_inbox_upsert(jsonb_build_array(pg_temp.r('SY-2', 'task', '{"notes":"Client sent the file"}')));
select pg_temp.check('a task follow-up becomes a comment on the task',
  (select count(*) = 1 and bool_and(content like '%Notes: Client sent the file%')
     from public.comments where task_id = pg_temp.task_of('SY-2')));

-- the bug was deleted in the portal: a follow-up is simply not synced
delete from public.bugs where id = pg_temp.bug_of('SY-1');
create temp table t_gone on commit drop as
  select public.whatsapp_inbox_upsert(jsonb_build_array(pg_temp.r('SY-1', 'bug', '{"status":"fixed"}'))) j;
select pg_temp.check('deleted bug: no error, counted as already_imported', (select (j->>'already_imported')::int = 1 from t_gone));

-- unchanged behaviour for items not imported yet
create temp table t_new on commit drop as
  select public.whatsapp_inbox_upsert(jsonb_build_array(
    jsonb_build_object('item_id', 'SY-3', 'type', 'bug', 'house', 'unknown', 'app_name', 'Synonosuchapp', 'title', 'New one'))) j;
create temp table t_again on commit drop as
  select public.whatsapp_inbox_upsert(jsonb_build_array(
    jsonb_build_object('item_id', 'SY-3', 'type', 'bug', 'house', 'unknown', 'app_name', 'Synonosuchapp', 'title', 'New one', 'notes', 'x'))) j;
select pg_temp.check('not imported yet: new, then updated (as before)',
  (select (j->>'new')::int = 1 from t_new) and (select (j->>'updated')::int = 1 from t_again));

set local role authenticated;
do $$ begin
  perform public.whatsapp_sync_imported_row('SY-1', '{}'::jsonb, '{}'::jsonb);
  insert into t_results (name, ok) values ('a signed-in user cannot call the sync', false);
exception when insufficient_privilege then
  insert into t_results (name, ok) values ('a signed-in user cannot call the sync', true);
end $$;
reset role;

do $$
declare v text;
begin
  select format('SYNC TESTS: %s passed, %s failed%s',
                count(*) filter (where ok), count(*) filter (where not ok),
                coalesce(E'\n' || string_agg(format('FAIL %s %s', name, coalesce(detail, '')), E'\n') filter (where not ok), ''))
    into v from t_results;
  raise exception '%', v;
end $$;
