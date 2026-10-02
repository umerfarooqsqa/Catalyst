-- =====================================================================
-- 0047: Grok sends its WhatsApp rows to catalyst; QA reviews them on /import/whatsapp.
--
-- Decided with the user (2026-10-02): after each triage upsert (or on demand) Grok POSTs the
-- "Catalyst import" rows to /api/intake/whatsapp with its key. The key can only put rows in
-- this inbox: nothing is filed until a QA/admin imports it (whatsapp_import, 0046).
--
-- One inbox row per item_id. A row sent again (Grok upserts) replaces the stored row and
-- bumps last_received_at. status:
--   new       - waiting for QA (only bug/task rows)
--   skipped   - support / fyi / duplicate / internal: never shown as waiting
--   dismissed - QA chose "skip" for it at an import; a later send keeps it dismissed
-- Imported items are the ones in whatsapp_items (0046); they are never "waiting".
-- Text is redacted on arrival (whatsapp_redact: AnyDesk IDs, phone numbers).
-- =====================================================================

create table if not exists public.whatsapp_inbox (
  item_id           text primary key check (item_id ~ '^[A-Za-z0-9._:@-]{3,200}$'),
  row               jsonb not null,
  status            text not null default 'new' check (status in ('new', 'skipped', 'dismissed')),
  received_count    integer not null default 1,
  first_received_at timestamptz not null default now(),
  last_received_at  timestamptz not null default now()
);
create index if not exists whatsapp_inbox_waiting_idx on public.whatsapp_inbox (last_received_at) where status = 'new';

alter table public.whatsapp_inbox enable row level security;
drop policy if exists whatsapp_inbox_select on public.whatsapp_inbox;
create policy whatsapp_inbox_select on public.whatsapp_inbox
  for select to authenticated using (public.is_qa_or_admin());
-- writes only through the functions below (the intake key) and whatsapp_inbox_dismiss (QA)

-- The columns of Grok's sheet; anything else is dropped.
create or replace function public.whatsapp_clean_row(p jsonb)
returns jsonb
language sql immutable
as $$
  select coalesce(jsonb_object_agg(k,
           case when k in ('item_id', 'first_seen', 'last_seen') then to_jsonb(left(v, 200))
                else to_jsonb(left(public.whatsapp_redact(v), 5000)) end), '{}'::jsonb)
  from (
    select lower(regexp_replace(regexp_replace(trim(e.key), '[^A-Za-z0-9]+', '_', 'g'), '^_|_$', '', 'g')) k,
           trim(e.value #>> '{}') v
    from jsonb_each(p) e
    where jsonb_typeof(e.value) in ('string', 'number', 'boolean')
  ) s
  where k in ('item_id', 'first_seen', 'last_seen', 'whatsapp_group', 'house', 'app_name', 'platform', 'type',
              'title', 'description', 'original_message', 'reporter', 'severity', 'category', 'area',
              'status', 'notes')
$$;

-- Called by the intake route (service role). Returns counts and the rows it refused.
create or replace function public.whatsapp_inbox_upsert(p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  e          record;
  v_row      jsonb;
  v_item     text;
  v_type     text;
  v_skip     boolean;
  v_prev     text;
  v_new      integer := 0;
  v_updated  integer := 0;
  v_imported integer := 0;
  v_skipped  integer := 0;
  v_rejected jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'rows must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'At most 500 rows per request.' using errcode = '22023';
  end if;

  for e in select value, ordinality - 1 as i from jsonb_array_elements(p_rows) with ordinality loop
    if jsonb_typeof(e.value) <> 'object' then
      v_rejected := v_rejected || jsonb_build_object('index', e.i, 'reason', 'not an object');
      continue;
    end if;
    v_row := public.whatsapp_clean_row(e.value);
    v_item := nullif(v_row->>'item_id', '');
    if v_item is null or v_item !~ '^[A-Za-z0-9._:@-]{3,200}$' then
      v_rejected := v_rejected || jsonb_build_object('index', e.i, 'item_id', v_item,
                      'reason', 'item_id missing or invalid (3-200 of A-Z a-z 0-9 . _ : @ -)');
      continue;
    end if;
    if nullif(v_row->>'title', '') is null then
      v_rejected := v_rejected || jsonb_build_object('index', e.i, 'item_id', v_item, 'reason', 'title missing');
      continue;
    end if;
    v_type := lower(coalesce(v_row->>'type', ''));
    v_skip := v_type not in ('bug', 'task')
              or lower(coalesce(v_row->>'status', '')) = 'duplicate'
              or lower(coalesce(v_row->>'house', '')) = 'internal';

    select status into v_prev from public.whatsapp_inbox where item_id = v_item for update;
    insert into public.whatsapp_inbox (item_id, row, status)
    values (v_item, v_row, case when v_skip then 'skipped' else 'new' end)
    on conflict (item_id) do update
      set row = excluded.row,
          status = case when whatsapp_inbox.status = 'dismissed' then 'dismissed' else excluded.status end,
          received_count = whatsapp_inbox.received_count + 1,
          last_received_at = now();

    if exists (select 1 from public.whatsapp_items w where w.item_id = v_item) then
      v_imported := v_imported + 1;
    elsif v_skip then
      v_skipped := v_skipped + 1;
    elsif v_prev is null then
      v_new := v_new + 1;
    else
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'received', jsonb_array_length(p_rows),
    'new', v_new, 'updated', v_updated, 'already_imported', v_imported, 'skipped', v_skipped,
    'rejected', v_rejected,
    'waiting_for_review', (select count(*) from public.whatsapp_inbox i
                            where i.status = 'new'
                              and not exists (select 1 from public.whatsapp_items w where w.item_id = i.item_id)));
end;
$$;

-- What QA still has to review: bug/task rows not imported and not dismissed. Runs as the caller (RLS).
create or replace function public.whatsapp_inbox_waiting()
returns setof public.whatsapp_inbox
language sql stable
set search_path = public
as $$
  select i.* from public.whatsapp_inbox i
  where i.status = 'new'
    and not exists (select 1 from public.whatsapp_items w where w.item_id = i.item_id)
  order by i.last_received_at
$$;

-- QA skipped these at an import: don't offer them again, even when Grok sends them again.
create or replace function public.whatsapp_inbox_dismiss(p_item_ids text[])
returns integer
language plpgsql security definer
set search_path = public
as $$
declare v integer;
begin
  if not public.is_qa_or_admin() then
    raise exception 'Only QA or an admin can dismiss.' using errcode = '42501';
  end if;
  update public.whatsapp_inbox set status = 'dismissed'
   where item_id = any (p_item_ids) and status = 'new';
  get diagnostics v = row_count;
  return v;
end;
$$;

-- For Grok's GET: how many rows are waiting, and when it last sent something.
create or replace function public.whatsapp_inbox_status()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'waiting_for_review', (select count(*) from public.whatsapp_inbox i where i.status = 'new'
                             and not exists (select 1 from public.whatsapp_items w where w.item_id = i.item_id)),
    'last_received_at', (select max(last_received_at) from public.whatsapp_inbox))
$$;

revoke all on function public.whatsapp_inbox_upsert(jsonb) from public, anon, authenticated;
revoke all on function public.whatsapp_inbox_status() from public, anon, authenticated;
revoke all on function public.whatsapp_clean_row(jsonb) from public, anon;
revoke all on function public.whatsapp_inbox_waiting() from public, anon;
grant execute on function public.whatsapp_inbox_waiting() to authenticated;
revoke all on function public.whatsapp_inbox_dismiss(text[]) from public, anon;
grant execute on function public.whatsapp_inbox_dismiss(text[]) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.whatsapp_inbox_upsert(jsonb) to service_role;
    grant execute on function public.whatsapp_inbox_status() to service_role;
  end if;
end;
$$;
