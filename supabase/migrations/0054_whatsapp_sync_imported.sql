-- =====================================================================
-- 0054: WhatsApp follow-ups on items already filed become a comment on the bug/task.
--
-- Proposed by Grok (2026-10-07), adjusted with the user. Problem: whatsapp_inbox_upsert (0047)
-- overwrites the inbox copy when an item_id that is already imported is sent again, but never
-- touches its bug/task, so a follow-up ("still open", new notes, re-triaged severity) never
-- reaches the portal, although the POST answered 200 (counted as already_imported).
--
-- Now: when a re-sent, already-imported row's status, notes, severity or description differs
-- from the previous inbox copy, a comment "WhatsApp update (<item_id>): ..." is posted on the
-- linked bug or task (no author; the comment list labels it "WhatsApp") and the row counts as
-- updated. Changes to Grok's adjustments, decided 2026-10-07:
--   * last_seen alone posts nothing: the Bot re-sends the whole sheet after every change (one item
--     arrived 25 times), and every comment notifies the assignee and can send an email. It is
--     shown inside a comment posted for a real change.
--   * severity is reported in the comment only; bugs.severity is not changed, so a WhatsApp
--     re-triage never silently undoes the severity QA set in the portal.
--   * values are compared ignoring case and surrounding spaces ("New" = "new ").
--   * the bug/task status is never changed: QA still decides fixed / done.
-- Unchanged re-sends still count as already_imported. A deleted bug/task (link cleared) is
-- skipped. whatsapp_inbox_upsert keeps 0047's logic otherwise (Grok's copy, compared line by line).
-- =====================================================================

create or replace function public.whatsapp_sync_imported_row(p_item_id text, p_old jsonb, p_new jsonb)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_bug   uuid;
  v_task  uuid;
  v_parts text[] := '{}';
  v_body  text;
  k       text;
begin
  select w.bug_id, w.task_id into v_bug, v_task from public.whatsapp_items w where w.item_id = p_item_id;
  if v_bug is null and v_task is null then
    return false;
  end if;

  foreach k in array array['status', 'severity'] loop
    if lower(trim(coalesce(p_old->>k, ''))) is distinct from lower(trim(coalesce(p_new->>k, ''))) then
      v_parts := v_parts || format('%s: %s → %s', initcap(k),
                   coalesce(nullif(trim(p_old->>k), ''), '(none)'),
                   coalesce(nullif(trim(p_new->>k), ''), '(none)'));
    end if;
  end loop;
  if trim(coalesce(p_old->>'notes', '')) is distinct from trim(coalesce(p_new->>'notes', '')) then
    v_parts := v_parts || ('Notes: ' || left(coalesce(nullif(trim(p_new->>'notes'), ''), '(cleared)'), 3500));
  end if;
  if trim(coalesce(p_old->>'description', '')) is distinct from trim(coalesce(p_new->>'description', ''))
     and nullif(trim(p_new->>'description'), '') is not null then
    v_parts := v_parts || ('Updated description: ' || left(trim(p_new->>'description'), 3500));
  end if;

  -- last_seen on its own is not news (see header)
  if cardinality(v_parts) = 0 then
    return false;
  end if;
  if nullif(trim(p_new->>'last_seen'), '') is not null then
    v_parts := v_parts || ('Last seen in WhatsApp: ' || trim(p_new->>'last_seen'));
  end if;

  v_body := public.whatsapp_redact('WhatsApp update (' || p_item_id || '):' || E'\n' || array_to_string(v_parts, E'\n'));
  if v_bug is not null then
    insert into public.comments (bug_id, content) values (v_bug, v_body);
  else
    insert into public.comments (task_id, content) values (v_task, v_body);
  end if;
  return true;
end;
$$;

revoke all on function public.whatsapp_sync_imported_row(text, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.whatsapp_inbox_upsert(p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  e          record;
  v_row      jsonb;
  v_old      jsonb;
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

    -- the previous copy too, to see what a re-send changed (0054)
    v_prev := null;
    v_old := null;
    select i.status, i.row into v_prev, v_old from public.whatsapp_inbox i where i.item_id = v_item for update;
    insert into public.whatsapp_inbox (item_id, row, status)
    values (v_item, v_row, case when v_skip then 'skipped' else 'new' end)
    on conflict (item_id) do update
      set row = excluded.row,
          status = case when whatsapp_inbox.status = 'dismissed' then 'dismissed' else excluded.status end,
          received_count = whatsapp_inbox.received_count + 1,
          last_received_at = now();

    if exists (select 1 from public.whatsapp_items w where w.item_id = v_item) then
      if v_old is not null and public.whatsapp_sync_imported_row(v_item, v_old, v_row) then
        v_updated := v_updated + 1;
      else
        v_imported := v_imported + 1;
      end if;
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
