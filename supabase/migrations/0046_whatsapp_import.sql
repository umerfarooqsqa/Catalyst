-- =====================================================================
-- 0046: import bugs and tasks from the Grok WhatsApp triage sheet.
--
-- Decided with the user (2026-10-02): Grok watches the client WhatsApp groups and keeps a
-- "Catalyst import" sheet, one row per item, with a stable item_id. A QA/admin uploads it on
-- /import/whatsapp; whatsapp_import() first returns a plan (dry run), then files the rows:
--   * type bug  -> a bug in the house's project (source 'whatsapp')
--   * type task -> a task in the house's project
--   * support / fyi / duplicate rows, internal groups and rows already imported are skipped.
-- An item_id is imported once ever (whatsapp_items), so the "still open" repeats in later
-- triage summaries never create a second bug.
--
-- Unknown projects (the user's request): when a row's app is not a catalyst project, the
-- import creates the project, named after the row's app_name, and files the row there.
-- Duplicates can't happen:
--   * a project is matched first by house, then by name: its name, its name without
--     "(iOS)", its name without any brackets, the abbreviation in brackets ("... (AHCML)"),
--     its house slug, the slug without "nxg". "namaa", " Namaa ", "NAMAA" are the same project.
--   * rows in one sheet that name the same new app create it once;
--   * projects.name_key + a unique index (name_key, platform) make a second project with the
--     same name on the same platform impossible, for every way of creating projects;
--   * imports run one at a time (advisory lock), and a concurrent creation is reused.
-- New projects are Android unless the row says iOS (then "<name> (iOS)"), so platform
-- developers can see them, and their description says they came from the import.
--
-- Privacy: digit runs that look like AnyDesk IDs or phone numbers are replaced by
-- [removed] before anything is stored, in case the sheet still has one.
-- =====================================================================

-- 1. bugs from WhatsApp get their own source -----------------------------------------
alter table public.bugs drop constraint if exists bugs_source_check;
alter table public.bugs add constraint bugs_source_check
  check (source = any (array['manual', 'automation', 'whatsapp']));

-- 2. One project per name and platform -------------------------------------------------
create or replace function public.project_name_key(p_name text)
returns text
language sql immutable
as $$
  select coalesce(nullif(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '', 'g'), ''),
                  lower(trim(coalesce(p_name, ''))))
$$;

alter table public.projects
  add column if not exists name_key text generated always as (public.project_name_key(name)) stored;
create unique index if not exists projects_name_key_platform_idx
  on public.projects (name_key, platform) nulls not distinct;

-- Every name a project can be found by.
create or replace function public.project_keys(p_name text, p_slug text, p_group text)
returns text[]
language sql immutable
as $$
  select coalesce(array_agg(distinct k), '{}')
  from unnest(array[
    public.project_name_key(p_name),
    public.project_name_key(regexp_replace(p_name, '\s*\((ios|android)\)\s*$', '', 'i')),
    public.project_name_key(regexp_replace(p_name, '\s*\([^()]*\)', '', 'g')),
    public.project_name_key(substring(p_name from '\(([^()]+)\)\s*(\((ios|android)\))?\s*$')),
    lower(p_slug),
    lower(p_group),
    regexp_replace(lower(coalesce(p_slug, p_group)), '^nxg', '')
  ]) k
  where k is not null and k <> '' and k not in ('ios', 'android')
$$;

-- 3. What has been imported (one row per WhatsApp item, ever) --------------------------
create table if not exists public.whatsapp_items (
  item_id        text primary key check (length(item_id) between 3 and 200),
  kind           text not null check (kind in ('bug', 'task')),
  project_id     uuid references public.projects(id) on delete set null,
  bug_id         uuid references public.bugs(id) on delete set null,
  task_id        uuid references public.tasks(id) on delete set null,
  whatsapp_group text,
  imported_at    timestamptz not null default now(),
  imported_by    uuid references public.profiles(id) on delete set null
);

alter table public.whatsapp_items enable row level security;
drop policy if exists whatsapp_items_select on public.whatsapp_items;
create policy whatsapp_items_select on public.whatsapp_items
  for select to authenticated using (public.is_qa_or_admin());
drop policy if exists whatsapp_items_insert on public.whatsapp_items;
create policy whatsapp_items_insert on public.whatsapp_items
  for insert to authenticated with check (public.is_qa_or_admin());

-- 4. Helpers -------------------------------------------------------------------------------
-- AnyDesk/TeamViewer IDs and phone numbers: 9+ digits, or digit groups like "169 519 7344".
create or replace function public.whatsapp_redact(p text)
returns text
language sql immutable
as $$
  select regexp_replace(coalesce(p, ''),
           '\m(\+?\d{9,}|\d{3,4}[ -]\d{3,4}[ -]\d{3,4}|\d{4}[ -]\d{6,8})\M', '[removed]', 'g')
$$;

-- The project for a row: by house first, then by name. how = house | name | ambiguous | none.
create or replace function public.whatsapp_find_project(p_house text, p_app text, p_platform text)
returns table (project_id uuid, project_name text, how text)
language plpgsql stable
set search_path = public
as $$
declare
  v_house text := lower(nullif(trim(coalesce(p_house, '')), ''));
  v_plat  text := case when lower(trim(coalesce(p_platform, ''))) in ('android', 'ios')
                       then lower(trim(p_platform)) end;
  v_key   text;
  v_ids   uuid[];
  v_rank  integer;
begin
  if v_house in ('unknown', 'internal', 'none', 'n/a', '-') then
    v_house := null;
  end if;

  if v_house is not null then
    if v_plat = 'ios' then
      return query select p.id, p.name, 'house'::text from public.projects p
                    where p.house_group = v_house and p.platform = 'ios' limit 1;
      if found then return; end if;
    end if;
    return query select p.id, p.name, 'house'::text from public.projects p
                  where p.house_slug = v_house limit 1;
    if found then return; end if;
    return query select p.id, p.name, 'house'::text from public.projects p
                  where p.house_group = v_house
                  order by (p.platform = 'android') desc nulls last limit 1;
    if found then return; end if;
  end if;

  -- by name: the app name, else a house value that isn't a known slug
  foreach v_key in array array[public.project_name_key(p_app), public.project_name_key(v_house)] loop
    continue when v_key is null or v_key = '';
    -- best platform first: the row's, else Android, else none, else the other
    select min(rk) into v_rank from (
      select case when v_plat is not null and p.platform = v_plat then 0
                  when p.platform = 'android' then 1
                  when p.platform is null then 2 else 3 end rk
      from public.projects p
      where v_key = any (public.project_keys(p.name, p.house_slug, p.house_group))
    ) s;
    continue when v_rank is null;
    select array_agg(p.id) into v_ids from public.projects p
     where v_key = any (public.project_keys(p.name, p.house_slug, p.house_group))
       and (case when v_plat is not null and p.platform = v_plat then 0
                 when p.platform = 'android' then 1
                 when p.platform is null then 2 else 3 end) = v_rank;
    if array_length(v_ids, 1) = 1 then
      return query select p.id, p.name, 'name'::text from public.projects p where p.id = v_ids[1];
    else
      return query select null::uuid, null::text, 'ambiguous'::text;
    end if;
    return;
  end loop;

  return query select null::uuid, null::text, 'none'::text;
end;
$$;

-- 5. The import -------------------------------------------------------------------------------
-- p_rows: the sheet's rows as objects (headers lower-case with underscores), each optionally
-- with project_id (chosen in the preview) or skip=true. Returns {rows: [...], created_projects: [...]}.
-- Runs as the caller (RLS applies): QA/admin only.
create or replace function public.whatsapp_import(
  p_rows jsonb,
  p_create_projects boolean default true,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r           jsonb;
  v_out       jsonb := '[]'::jsonb;
  v_created   jsonb := '[]'::jsonb;
  v_planned   jsonb := '{}'::jsonb;     -- new projects in this run: "<name_key>|<platform>" -> {id, name}
  v_seen      text[] := '{}';
  v_item      text;
  v_type      text;
  v_status    text;
  v_title     text;
  v_house     text;
  v_app       text;
  v_plat      text;
  v_group     text;
  v_project   uuid;
  v_pname     text;
  v_how       text;
  v_new_name  text;
  v_new_plat  text;
  v_pkey      text;
  v_reason    text;
  v_sev       public.bug_severity;
  v_prio      public.bug_priority;
  v_cat       uuid;
  v_area      text;
  v_desc      text;
  v_release   uuid;
  v_bug       uuid;
  v_task      uuid;
  v_action    text;
begin
  if not public.is_qa_or_admin() then
    raise exception 'Only QA or an admin can import from WhatsApp.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'rows must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'At most 2000 rows per import.' using errcode = '22023';
  end if;
  -- one import at a time, so two people uploading the same sheet can't both file an item
  perform pg_advisory_xact_lock(hashtext('catalyst-whatsapp-import'));

  for r in select value from jsonb_array_elements(p_rows) loop
    v_item    := nullif(trim(coalesce(r->>'item_id', '')), '');
    v_type    := lower(trim(coalesce(r->>'type', '')));
    v_status  := lower(trim(coalesce(r->>'status', '')));
    v_title   := left(public.whatsapp_redact(trim(coalesce(r->>'title', ''))), 200);
    v_house   := trim(coalesce(r->>'house', ''));
    v_app     := nullif(trim(coalesce(r->>'app_name', '')), '');
    v_plat    := lower(trim(coalesce(r->>'platform', '')));
    v_group   := nullif(trim(coalesce(r->>'whatsapp_group', '')), '');
    v_project := null; v_pname := null; v_how := null; v_new_name := null; v_new_plat := null;
    v_reason  := null; v_action := 'skip'; v_bug := null; v_task := null;

    if v_item is null then
      v_reason := 'no item_id';
    elsif v_item = any (v_seen) then
      v_reason := 'repeated in this sheet';
    elsif exists (select 1 from public.whatsapp_items w where w.item_id = v_item) then
      v_reason := 'already imported';
      select w.project_id, w.bug_id, w.task_id into v_project, v_bug, v_task
        from public.whatsapp_items w where w.item_id = v_item;
    elsif coalesce((r->>'skip')::boolean, false) then
      v_reason := 'skipped in the preview';
    elsif v_type not in ('bug', 'task') then
      v_reason := case when v_type = '' then 'no type' else v_type end;
    elsif v_status = 'duplicate' then
      v_reason := 'marked duplicate';
    elsif lower(v_house) = 'internal' then
      v_reason := 'internal group';
    elsif v_title = '' then
      v_reason := 'no title';
    end if;
    if v_item is not null then
      v_seen := v_seen || v_item;
    end if;

    if v_reason is null then
      -- the project: chosen in the preview, else found, else created
      if nullif(r->>'project_id', '') is not null then
        select p.id, p.name into v_project, v_pname from public.projects p
         where p.id = (r->>'project_id')::uuid;
        v_how := 'chosen';
        if v_project is null then v_reason := 'chosen project not found'; end if;
      else
        select f.project_id, f.project_name, f.how into v_project, v_pname, v_how
          from public.whatsapp_find_project(v_house, v_app, v_plat) f;
        if v_project is null then
          v_new_name := coalesce(v_app,
                          case when lower(v_house) not in ('', 'unknown', 'none', 'n/a', '-') then v_house end);
          if v_how = 'ambiguous' then
            v_reason := 'more than one project matches; choose one';
          elsif v_new_name is null then
            v_reason := 'no house or app name';
          elsif not p_create_projects then
            v_reason := format('no project for "%s"', v_new_name);
          else
            v_new_name := left(regexp_replace(trim(v_new_name), '\s+', ' ', 'g'), 120);
            v_new_plat := case when v_plat = 'ios' then 'ios' else 'android' end;
            if v_new_plat = 'ios' and v_new_name !~* '\(ios\)\s*$' then
              v_new_name := v_new_name || ' (iOS)';
            end if;
            v_pkey := public.project_name_key(v_new_name) || '|' || v_new_plat;
            if v_planned ? v_pkey then
              v_project := nullif(v_planned->v_pkey->>'id', '')::uuid;
              v_pname := v_planned->v_pkey->>'name';
            elsif not p_dry_run then
              insert into public.projects (name, description, platform, created_by)
              values (v_new_name,
                      format('Created automatically by the WhatsApp import%s on %s. Check its name and platform, and set its app (house) if it has one.',
                             coalesce(format(' (group "%s")', v_group), ''), to_char(now(), 'YYYY-MM-DD')),
                      v_new_plat, auth.uid())
              on conflict (name_key, platform) do nothing
              returning id, name into v_project, v_pname;
              if v_project is null then
                -- created a moment ago by someone else: use theirs
                select p.id, p.name into v_project, v_pname from public.projects p
                 where p.name_key = public.project_name_key(v_new_name) and p.platform = v_new_plat;
              else
                v_created := v_created || jsonb_build_object('id', v_project, 'name', v_pname, 'platform', v_new_plat);
              end if;
              v_planned := v_planned || jsonb_build_object(v_pkey, jsonb_build_object('id', v_project, 'name', v_pname));
            else
              v_pname := v_new_name;
              v_planned := v_planned || jsonb_build_object(v_pkey, jsonb_build_object('id', null, 'name', v_new_name));
              v_created := v_created || jsonb_build_object('id', null, 'name', v_new_name, 'platform', v_new_plat);
            end if;
            v_how := 'new';
          end if;
        end if;
      end if;
    end if;

    if v_reason is null then
      v_action := v_type;
      v_sev := case when lower(trim(coalesce(r->>'severity', ''))) in ('critical', 'major', 'minor', 'trivial')
                    then lower(trim(r->>'severity'))::public.bug_severity else 'minor' end;
      v_prio := case v_sev when 'critical' then 'high' when 'major' then 'high'
                           when 'trivial' then 'low' else 'medium' end::public.bug_priority;
      select c.id into v_cat from public.bug_categories c
       where public.project_name_key(c.name) = public.project_name_key(r->>'category') limit 1;
      select rc.key into v_area from public.role_categories rc
       where lower(trim(coalesce(r->>'area', ''))) in (lower(rc.key), lower(rc.short_label), lower(rc.label)) limit 1;
      v_desc := public.whatsapp_redact(concat_ws(E'\n\n',
        nullif(trim(coalesce(r->>'description', '')), ''),
        case when nullif(trim(coalesce(r->>'original_message', '')), '') is not null
             then 'Original message: ' || trim(r->>'original_message') end,
        concat_ws(' ',
          'Reported' || coalesce(' by ' || nullif(trim(coalesce(r->>'reporter', '')), ''), ''),
          coalesce('in WhatsApp group "' || v_group || '"', ''),
          coalesce('on ' || nullif(trim(coalesce(r->>'first_seen', '')), ''), '')) || '.',
        case when v_plat in ('web', 'android', 'ios') then 'Platform: ' || v_plat end,
        case when nullif(trim(coalesce(r->>'notes', '')), '') is not null then 'Notes: ' || trim(r->>'notes') end,
        'WhatsApp item: ' || v_item));

      if not p_dry_run then
        if v_type = 'bug' then
          select rl.id into v_release from public.releases rl
            join public.projects p on p.id = rl.project_id
           where rl.project_id = v_project and rl.version = p.current_version limit 1;
          insert into public.bugs (project_id, title, description, severity, priority, category_id, area,
                                   source, automation_key, release_id, created_by)
          values (v_project, v_title, v_desc, v_sev, v_prio, v_cat, v_area,
                  'whatsapp', 'whatsapp:' || v_item, v_release, auth.uid())
          returning id into v_bug;
        else
          insert into public.tasks (project_id, title, description, priority, area, created_by)
          values (v_project, v_title, v_desc, v_prio, v_area, auth.uid())
          returning id into v_task;
        end if;
        insert into public.whatsapp_items (item_id, kind, project_id, bug_id, task_id, whatsapp_group, imported_by)
        values (v_item, v_type, v_project, v_bug, v_task, v_group, auth.uid());
      end if;
    end if;

    v_out := v_out || jsonb_build_object(
      'item_id', v_item, 'action', v_action, 'reason', v_reason, 'title', v_title,
      'project_id', v_project, 'project_name', v_pname, 'how', v_how,
      'severity', case when v_action <> 'skip' then v_sev end,
      'category_id', case when v_action <> 'skip' then v_cat end,
      'area', case when v_action <> 'skip' then v_area end,
      'bug_id', v_bug, 'task_id', v_task);
    v_cat := null; v_area := null; v_release := null;
  end loop;

  return jsonb_build_object('rows', v_out, 'created_projects', v_created, 'dry_run', p_dry_run);
end;
$$;

revoke all on function public.whatsapp_import(jsonb, boolean, boolean) from public, anon;
grant execute on function public.whatsapp_import(jsonb, boolean, boolean) to authenticated;
revoke all on function public.whatsapp_find_project(text, text, text) from public, anon;
grant execute on function public.whatsapp_find_project(text, text, text) to authenticated;
