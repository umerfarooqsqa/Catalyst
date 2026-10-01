-- =====================================================================
-- 0020 — Portal-wide audit trail. Every insert/update/delete on the
-- data-changing tables listed below is recorded in a single global
-- `audit_log` table: who did it, what table/row, what changed, when.
--
-- This is separate from `task_audit_log` (0019), which stays as-is —
-- it's the richer, per-task history that feeds TaskDrawer's "Audit
-- log" section with friendly resolved labels (assignee names, etc).
-- Tasks are ALSO captured here so the portal-wide view has no blind
-- spot; a little duplication between the two is an accepted tradeoff.
--
-- Unlike task_audit_log, rows here are NOT linked by a cascading FK to
-- the row they describe — entity_id is a bare uuid, no FK constraint —
-- so a deleted bug/task/requirement/etc. leaves its full trail behind,
-- including the delete event itself. This table is meant to outlive
-- the rows it describes.
--
-- Not covered: `project_members` (composite PK, no single `id` column
-- — the generic trigger below needs one; membership changes are
-- visible via project settings instead) and Supabase Auth events
-- (login/logout live in Supabase's own auth logs, not app tables).
-- =====================================================================

create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.profiles(id) on delete set null,
  action       text not null,        -- 'insert' | 'update' | 'delete'
  entity_type  text not null,        -- source table name
  entity_id    uuid not null,
  entity_label text,                 -- best-effort human label (title/name/etc), snapshotted at write time
  project_id   uuid,                 -- best-effort, for scoping — no FK (must survive project deletion too)
  changes      jsonb,                -- update: {field: {from, to}}; insert/delete: full row snapshot
  summary      text,                 -- short human-readable line, precomputed for the list view
  created_at   timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log(created_at desc);
create index audit_log_entity_idx on public.audit_log(entity_type, entity_id);
create index audit_log_project_idx on public.audit_log(project_id);
create index audit_log_actor_idx on public.audit_log(actor_id);

alter table public.audit_log enable row level security;

-- Admin-only: this is a compliance/oversight tool, not a per-project feed.
create policy "audit_log_admin_select" on public.audit_log
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- Generic trigger: works against any table with a uuid `id` primary
-- key. Skips no-op updates (only `updated_at` bumped) so the log stays
-- signal, not noise. Long free-text fields are noted as "changed"
-- rather than diffed in full in the summary line (the full old/new
-- values are still in `changes` for anyone who opens the row).
-- ---------------------------------------------------------------------
create or replace function public.audit_log_row()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_row jsonb;
  v_entity_id uuid;
  v_project_id uuid;
  v_label text;
  v_changes jsonb := '{}'::jsonb;
  v_summary text;
  key text;
  v_from text;
  v_to text;
  v_parts text[] := '{}';
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  begin
    v_entity_id := (v_row->>'id')::uuid;
  exception when others then
    return coalesce(new, old);
  end;

  begin
    v_project_id := (v_row->>'project_id')::uuid;
  exception when others then
    v_project_id := null;
  end;

  v_label := coalesce(
    v_row->>'title', v_row->>'name', v_row->>'full_name',
    v_row->>'file_name', v_row->>'label',
    left(v_row->>'content', 80)
  );

  if tg_op = 'UPDATE' then
    for key in select jsonb_object_keys(to_jsonb(new)) loop
      if key = 'updated_at' then continue; end if;
      if (to_jsonb(old)->key) is distinct from (to_jsonb(new)->key) then
        v_changes := v_changes || jsonb_build_object(
          key, jsonb_build_object('from', to_jsonb(old)->key, 'to', to_jsonb(new)->key)
        );
        if key in ('description', 'content', 'steps_to_reproduce', 'template_steps') then
          v_parts := v_parts || (key || ' changed');
        else
          v_from := left(coalesce(to_jsonb(old)->>key, '—'), 40);
          v_to := left(coalesce(to_jsonb(new)->>key, '—'), 40);
          v_parts := v_parts || (key || ': ' || v_from || ' → ' || v_to);
        end if;
      end if;
    end loop;
    if array_length(v_parts, 1) is null then
      return new; -- nothing meaningful changed
    end if;
    v_summary := array_to_string(v_parts, ', ');
  elsif tg_op = 'INSERT' then
    v_summary := 'created';
    v_changes := v_row;
  else
    v_summary := 'deleted';
    v_changes := v_row;
  end if;

  insert into public.audit_log
    (actor_id, action, entity_type, entity_id, entity_label, project_id, changes, summary)
  values
    (v_actor, lower(tg_op), tg_table_name, v_entity_id, v_label, v_project_id, v_changes, v_summary);

  return coalesce(new, old);
end;
$$;

revoke all on function public.audit_log_row() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Attach to every data-changing table in the app (see header note for
-- what's excluded and why).
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'bugs', 'tasks', 'requirements', 'test_cases', 'projects',
    'comments', 'attachments', 'base_page', 'requirement_documents',
    'profiles', 'roles'
  ]
  loop
    execute format(
      'drop trigger if exists trg_audit_log on public.%I; ' ||
      'create trigger trg_audit_log after insert or update or delete on public.%I ' ||
      'for each row execute function public.audit_log_row();',
      t, t
    );
  end loop;
end $$;
