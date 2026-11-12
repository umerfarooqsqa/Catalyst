-- Tests for 0052_whatsapp_intake_senders.sql. ONE transaction that always ends in an error carrying
-- the results ("SENDER TESTS: n passed, m failed"), so nothing is ever committed.
-- Run: node scripts/whatsapp-import-test.mjs (live, Management API), or any psql session.
begin;

update private.settings set value = '' where key = 'email_dispatch_url';
create temp table t_results (n serial, name text, ok boolean, detail text) on commit drop;
grant all on t_results to authenticated;
grant usage on sequence t_results_n_seq to authenticated;
create function pg_temp.check(p_name text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into t_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;

select public.whatsapp_inbox_upsert('[
  {"item_id":"SND-1","type":"bug","house":"unknown","app_name":"Sndnosuchapp","title":"From the Bot"},
  {"item_id":"SND-2","type":"bug","house":"unknown","app_name":"Sndnosuchapp","title":"From the tracker"}
]');
select pg_temp.check('a new row has no sender until the route sets it',
  (select sender is null from public.whatsapp_inbox where item_id = 'SND-1'));
create temp table t_n on commit drop as
  select public.whatsapp_inbox_set_sender(array['SND-1'], 'whatsapp_bot') a,
         public.whatsapp_inbox_set_sender(array['SND-2', 'SND-nope'], 'tracker') b;
select pg_temp.check('the route records each row''s sender (unknown ids ignored)',
  (select a = 1 and b = 1 from t_n)
  and (select sender = 'whatsapp_bot' from public.whatsapp_inbox where item_id = 'SND-1')
  and (select sender = 'tracker' from public.whatsapp_inbox where item_id = 'SND-2'));
select public.whatsapp_inbox_set_sender(array['SND-1'], 'tracker');
select pg_temp.check('a resend by the other sender updates it (last sender wins)',
  (select sender = 'tracker' from public.whatsapp_inbox where item_id = 'SND-1'));
do $$ begin
  perform public.whatsapp_inbox_set_sender(array['SND-1'], 'someone');
  insert into t_results (name, ok) values ('an unknown sender is refused', false);
exception when check_violation then
  insert into t_results (name, ok) values ('an unknown sender is refused', true);
end $$;
select public.whatsapp_inbox_upsert('[{"item_id":"SND-1","type":"bug","house":"unknown","app_name":"Sndnosuchapp","title":"From the Bot, again"}]');
select pg_temp.check('a resend keeps the recorded sender until the route sets it again',
  (select sender = 'tracker' and received_count = 2 from public.whatsapp_inbox where item_id = 'SND-1'));

set local role authenticated;
do $$ begin
  perform public.whatsapp_inbox_set_sender(array['SND-1'], 'tracker');
  insert into t_results (name, ok) values ('a signed-in user cannot set a sender', false);
exception when insufficient_privilege then
  insert into t_results (name, ok) values ('a signed-in user cannot set a sender', true);
end $$;
reset role;

do $$
declare v text;
begin
  select format('SENDER TESTS: %s passed, %s failed%s',
                count(*) filter (where ok), count(*) filter (where not ok),
                coalesce(E'\n' || string_agg(format('FAIL %s %s', name, coalesce(detail, '')), E'\n') filter (where not ok), ''))
    into v from t_results;
  raise exception '%', v;
end $$;
