-- =====================================================================
-- 0048: Grok's rows are filed automatically; only rows without a project wait for review.
--
-- Decided with the user (2026-10-02, replacing "QA reviews every row"): when Grok sends rows
-- (/api/intake/whatsapp), every bug/task row whose project is found (by house or by name)
-- is filed at once. Rows that would need a NEW project, match several projects, or have no
-- house/app name stay in the inbox for QA on /import/whatsapp, where a project can be chosen
-- or created ("Create a project for apps that aren't in catalyst yet").
-- The automatic import never creates projects, so it can't create a wrong or duplicate one.
--
-- whatsapp_import() keeps its contract (QA/admin, preview + import) but now calls
-- whatsapp_import_core(), which holds 0046's logic unchanged and is callable only by the
-- database owner, the QA wrapper and the service role (auth.uid() still marks who imported;
-- automatic imports have none).
-- =====================================================================

create or replace function public.whatsapp_import_core(
  p_rows jsonb,
  p_create_projects boolean default true,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql security definer
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

revoke all on function public.whatsapp_import_core(jsonb, boolean, boolean) from public, anon, authenticated;

-- QA/admin entry point (the import page): same arguments and result as 0046.
create or replace function public.whatsapp_import(
  p_rows jsonb,
  p_create_projects boolean default true,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_qa_or_admin() then
    raise exception 'Only QA or an admin can import from WhatsApp.' using errcode = '42501';
  end if;
  return public.whatsapp_import_core(p_rows, p_create_projects, p_dry_run);
end;
$$;

revoke all on function public.whatsapp_import(jsonb, boolean, boolean) from public, anon;
grant execute on function public.whatsapp_import(jsonb, boolean, boolean) to authenticated;

-- After each send from Grok: file every waiting row whose project is known; never create one.
create or replace function public.whatsapp_auto_import()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_rows jsonb;
  v_res  jsonb;
begin
  select jsonb_agg(i.row order by i.first_received_at) into v_rows
    from public.whatsapp_inbox i
   where i.status = 'new'
     and not exists (select 1 from public.whatsapp_items w where w.item_id = i.item_id);
  if v_rows is null then
    return jsonb_build_object('bugs', 0, 'tasks', 0, 'held_for_review', 0, 'rows', '[]'::jsonb);
  end if;
  v_res := public.whatsapp_import_core(v_rows, false, false);
  return jsonb_build_object(
    'bugs', (select count(*) from jsonb_array_elements(v_res->'rows') x where x->>'action' = 'bug'),
    'tasks', (select count(*) from jsonb_array_elements(v_res->'rows') x where x->>'action' = 'task'),
    'held_for_review', (select count(*) from jsonb_array_elements(v_res->'rows') x
                         where x->>'action' = 'skip' and x->>'reason' <> 'already imported'),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('item_id', x->>'item_id', 'action', x->>'action',
                                                          'project', x->>'project_name', 'reason', x->>'reason')), '[]'::jsonb)
             from jsonb_array_elements(v_res->'rows') x));
end;
$$;

revoke all on function public.whatsapp_auto_import() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.whatsapp_auto_import() to service_role;
  end if;
end;
$$;
