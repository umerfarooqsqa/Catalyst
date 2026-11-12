-- =====================================================================
-- 0051: QA asks Grok to scan all WhatsApp groups.
--
-- Decided with the user (2026-10-05): "Ask Grok to scan all groups" (Bug Library's WhatsApp
-- dialog, /import/whatsapp) QUEUES a request, then the portal (POST /api/whatsapp/scan) calls
-- Grok's webhook routine (GROK_WEBHOOK_URL) so Grok starts at once. If no webhook is set or the
-- call fails, Grok's next scheduled GET /api/intake/whatsapp still returns it as scan_request.
-- Grok scans every group since `since`, POSTs the sheet with scan_request_id, and the request
-- is done. The rows go through the intake as before (0047-0050).
--   * since = the last completed scan minus 1 hour (rows are de-duplicated by item_id), the
--     first time 7 days ago ("since the last scan", decided with the user).
--   * status: pending (queued) -> seen (Grok's GET returned it) -> done; or cancelled (QA),
--     or expired (still open after 24 h, closed when someone asks again).
--   * One open request at a time; asking again returns the open one.
--   * QA reads the table; writes go through the functions. Grok's two functions are for the
--     service role only (the intake route, behind WHATSAPP_INTAKE_KEY).
-- whatsapp_inbox_status() is unchanged, so the previous build keeps working.
-- =====================================================================

create table if not exists public.whatsapp_scan_requests (
  id            uuid primary key default gen_random_uuid(),
  scope         text not null default 'all_groups' check (scope in ('all_groups')),
  since         timestamptz not null,
  status        text not null default 'pending'
                  check (status in ('pending', 'seen', 'done', 'cancelled', 'expired')),
  requested_by  uuid references public.profiles(id) on delete set null,
  requested_at  timestamptz not null default now(),
  seen_at       timestamptz,
  completed_at  timestamptz,
  rows_received integer not null default 0,
  note          text check (length(note) <= 2000),
  notified_at   timestamptz,          -- Grok's webhook accepted the request (POST /api/whatsapp/scan)
  notify_error  text check (length(notify_error) <= 500)   -- the webhook's last failure, if any
);
create unique index if not exists whatsapp_scan_requests_one_open_idx
  on public.whatsapp_scan_requests ((true)) where status in ('pending', 'seen');
create index if not exists whatsapp_scan_requests_requested_idx
  on public.whatsapp_scan_requests (requested_at desc);

alter table public.whatsapp_scan_requests enable row level security;
drop policy if exists whatsapp_scan_requests_select on public.whatsapp_scan_requests;
create policy whatsapp_scan_requests_select on public.whatsapp_scan_requests
  for select to authenticated using (public.is_qa_or_admin());
-- no insert/update/delete policies: writes go through the functions below

-- QA: ask for a scan of all groups. Returns the open request (an existing one, or a new one).
create or replace function public.whatsapp_request_scan()
returns public.whatsapp_scan_requests
language plpgsql security definer
set search_path = public
as $$
declare
  v public.whatsapp_scan_requests;
begin
  if not public.is_qa_or_admin() then
    raise exception 'Only QA or an admin can ask Grok to scan.' using errcode = '42501';
  end if;
  -- one request at a time, even when two people click at once
  perform pg_advisory_xact_lock(hashtext('catalyst-whatsapp-scan'));
  update public.whatsapp_scan_requests set status = 'expired'
   where status in ('pending', 'seen') and requested_at < now() - interval '24 hours';
  select * into v from public.whatsapp_scan_requests where status in ('pending', 'seen') limit 1;
  if found then
    return v;
  end if;
  insert into public.whatsapp_scan_requests (since, requested_by)
  values (coalesce((select max(completed_at) from public.whatsapp_scan_requests where status = 'done')
                     - interval '1 hour',
                   now() - interval '7 days'),
          auth.uid())
  returning * into v;
  return v;
end;
$$;

-- QA: cancel an open request.
create or replace function public.whatsapp_cancel_scan(p_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_qa_or_admin() then
    raise exception 'Only QA or an admin can cancel a scan.' using errcode = '42501';
  end if;
  update public.whatsapp_scan_requests set status = 'cancelled'
   where id = p_id and status in ('pending', 'seen');
  return found;
end;
$$;

-- Grok's GET: the open request, if any; the first time it is returned it becomes "seen".
create or replace function public.whatsapp_scan_pending()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v public.whatsapp_scan_requests;
begin
  update public.whatsapp_scan_requests set status = 'expired'
   where status in ('pending', 'seen') and requested_at < now() - interval '24 hours';
  update public.whatsapp_scan_requests set status = 'seen', seen_at = now()
   where status = 'pending'
  returning * into v;
  if v.id is null then
    select * into v from public.whatsapp_scan_requests where status = 'seen' limit 1;
  end if;
  if v.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'id', v.id,
    'scope', v.scope,
    'since', v.since,
    'requested_at', v.requested_at,
    'requested_by', (select full_name from public.profiles where id = v.requested_by),
    'instructions', format('Scan ALL WhatsApp groups for messages since %s, update the "Catalyst import" sheet, '
                           'then POST the whole sheet here with "scan_request_id": "%s" and "scan_done": true '
                           '(batches of up to 500 rows: "scan_done": false until the last). Nothing new: POST '
                           '{"rows": [], "scan_request_id": "%s", "scan_done": true}.',
                           to_char(v.since at time zone 'Asia/Karachi', 'YYYY-MM-DD HH24:MI "PKT"'), v.id, v.id));
end;
$$;

-- Grok's POST with a scan_request_id: count its rows; the last batch (done) completes it.
create or replace function public.whatsapp_scan_report(p_id uuid, p_rows integer, p_note text, p_done boolean)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v public.whatsapp_scan_requests;
begin
  update public.whatsapp_scan_requests
     set rows_received = rows_received + greatest(coalesce(p_rows, 0), 0),
         note = coalesce(left(nullif(trim(coalesce(p_note, '')), ''), 2000), note),
         seen_at = coalesce(seen_at, now()),
         status = case when coalesce(p_done, true) then 'done' else 'seen' end,
         completed_at = case when coalesce(p_done, true) then now() end
   where id = p_id and status in ('pending', 'seen')
  returning * into v;
  if v.id is null then
    select * into v from public.whatsapp_scan_requests where id = p_id;
    return jsonb_build_object('id', p_id, 'status', coalesce(v.status, 'unknown'),
      'ignored', true,
      'reason', case when v.id is null then 'no such scan request'
                     else format('this scan request is already %s', v.status) end);
  end if;
  return jsonb_build_object('id', v.id, 'status', v.status, 'rows_received', v.rows_received);
end;
$$;

-- The portal route that calls Grok's webhook records the outcome (service role only).
create or replace function public.whatsapp_scan_notified(p_id uuid, p_error text)
returns void
language sql security definer
set search_path = public
as $$
  update public.whatsapp_scan_requests
     set notified_at = case when p_error is null then now() else notified_at end,
         notify_error = left(p_error, 500)
   where id = p_id
$$;

revoke all on function public.whatsapp_scan_notified(uuid, text) from public, anon, authenticated;
revoke all on function public.whatsapp_request_scan() from public, anon;
grant execute on function public.whatsapp_request_scan() to authenticated;
revoke all on function public.whatsapp_cancel_scan(uuid) from public, anon;
grant execute on function public.whatsapp_cancel_scan(uuid) to authenticated;
revoke all on function public.whatsapp_scan_pending() from public, anon, authenticated;
revoke all on function public.whatsapp_scan_report(uuid, integer, text, boolean) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.whatsapp_scan_pending() to service_role;
    grant execute on function public.whatsapp_scan_report(uuid, integer, text, boolean) to service_role;
    grant execute on function public.whatsapp_scan_notified(uuid, text) to service_role;
  end if;
end;
$$;
