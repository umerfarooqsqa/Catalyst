-- =====================================================================
-- 0016 — Web Push subscriptions, realtime notifications, push webhook
--   * push_subscriptions: one row per browser/device endpoint, per user
--   * notifications published on the realtime channel (live in-app bell)
--   * AFTER INSERT webhook on notifications -> app /api/push/dispatch,
--     which sends the actual Web Push. Inert until private.settings holds
--     'push_dispatch_url' and 'push_dispatch_secret'.
-- =====================================================================

-- 1. Per-user push subscriptions -------------------------------------------------
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_own_select" on public.push_subscriptions;
drop policy if exists "push_subscriptions_own_insert" on public.push_subscriptions;
drop policy if exists "push_subscriptions_own_update" on public.push_subscriptions;
drop policy if exists "push_subscriptions_own_delete" on public.push_subscriptions;

create policy "push_subscriptions_own_select" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());
create policy "push_subscriptions_own_insert" on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());
create policy "push_subscriptions_own_update" on public.push_subscriptions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "push_subscriptions_own_delete" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- 2. Live in-app bell — publish notifications on the realtime channel ----------
alter table public.notifications replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- 3. Private config for the push webhook (never exposed to app users) ----------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.settings (
  key   text primary key,
  value text
);

-- 4. Webhook: on every new notification, POST it to the app so it can send
--    a Web Push to that user's devices. No-op until configured with:
--      insert into private.settings (key, value) values
--        ('push_dispatch_url',    'https://YOUR_APP/api/push/dispatch'),
--        ('push_dispatch_secret', 'must equal PUSH_DISPATCH_SECRET in the app env')
--      on conflict (key) do update set value = excluded.value;
create extension if not exists pg_net;

create or replace function public.notifications_push_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public, private, net
as $$
declare
  v_url    text := (select value from private.settings where key = 'push_dispatch_url');
  v_secret text := (select value from private.settings where key = 'push_dispatch_secret');
begin
  if v_url is null or v_url = '' then
    return new;                       -- not configured yet
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'X-Push-Secret', coalesce(v_secret, '')
               ),
    body    := jsonb_build_object(
                 'notification_id', new.id,
                 'user_id',         new.user_id,
                 'type',            new.type,
                 'message',         new.message,
                 'related_bug_id',  new.related_bug_id,
                 'related_task_id', new.related_task_id
               ),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

revoke all on function public.notifications_push_dispatch() from public, anon, authenticated;

drop trigger if exists trg_notifications_push on public.notifications;
create trigger trg_notifications_push
  after insert on public.notifications
  for each row execute function public.notifications_push_dispatch();
