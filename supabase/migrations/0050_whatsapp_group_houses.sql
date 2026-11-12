-- =====================================================================
-- 0050: a house per WhatsApp group, set from the Bug Library.
--
-- Decided with the user (2026-10-05): the Bug Library has a "WhatsApp from Grok" button. It
-- lists Grok's waiting messages by WhatsApp group, and QA gives each group its house (the
-- house's project). Catalyst remembers it, so Grok's later rows from that group are filed
-- there automatically. The messages still become bugs or tasks in the house's project, the
-- same as the WhatsApp import (0046-0049). They do not become Bug Library entries.
--   * whatsapp_groups: one row per group (key = project_name_key of its name): its project,
--     or "mixed" when one group covers several houses ("Catalyst & MRA development": D-Trade
--     and Wiqaya). A mixed group's messages are still matched one by one (house, name), and
--     QA chooses for the ones that stay unclear.
--   * Order for a row: QA's choice for that message, then the row's house (Grok's house
--     value wins, since it names the house), then the group's house, then the name (0049).
--   * An iOS row from a group set to an Android project goes to that house's iOS project
--     (same house_group) when it exists, and the other way round.
--   * Written only through whatsapp_set_group() (QA/admin). The automatic import never
--     changes the groups.
-- Needs 0049 (whatsapp_explain_matches): the import entry points are replaced again here.
-- =====================================================================

create table if not exists public.whatsapp_groups (
  group_key  text primary key check (length(group_key) between 1 and 200),
  group_name text not null check (length(group_name) between 1 and 200),
  project_id uuid references public.projects(id) on delete set null,
  mixed      boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint whatsapp_groups_project_or_mixed check (not (mixed and project_id is not null))
);

alter table public.whatsapp_groups enable row level security;
drop policy if exists whatsapp_groups_select on public.whatsapp_groups;
create policy whatsapp_groups_select on public.whatsapp_groups
  for select to authenticated using (public.is_qa_or_admin());
-- no insert/update/delete policies: writes go through whatsapp_set_group()

-- Set a group's house (p_project), mark it mixed, or clear it (neither).
create or replace function public.whatsapp_set_group(p_group text, p_project uuid, p_mixed boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_name text := left(regexp_replace(trim(coalesce(p_group, '')), '\s+', ' ', 'g'), 200);
  v_key  text := public.project_name_key(v_name);
  v_pname text;
begin
  if not public.is_qa_or_admin() then
    raise exception 'Only QA or an admin can set a WhatsApp group''s house.' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'No group name.' using errcode = '22023';
  end if;
  if p_project is not null and coalesce(p_mixed, false) then
    raise exception 'A group has one house or is mixed, not both.' using errcode = '22023';
  end if;
  if p_project is not null then
    select p.name into v_pname from public.projects p where p.id = p_project;
    if v_pname is null then
      raise exception 'That project does not exist.' using errcode = '22023';
    end if;
  end if;

  if p_project is null and not coalesce(p_mixed, false) then
    delete from public.whatsapp_groups where group_key = v_key;
  else
    insert into public.whatsapp_groups (group_key, group_name, project_id, mixed, updated_by, updated_at)
    values (v_key, v_name, p_project, coalesce(p_mixed, false), auth.uid(), now())
    on conflict (group_key) do update
      set group_name = excluded.group_name, project_id = excluded.project_id, mixed = excluded.mixed,
          updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  return jsonb_build_object('group_key', v_key, 'group_name', v_name, 'project_id', p_project,
                            'project_name', v_pname, 'mixed', coalesce(p_mixed, false));
end;
$$;

revoke all on function public.whatsapp_set_group(text, uuid, boolean) from public, anon;
grant execute on function public.whatsapp_set_group(text, uuid, boolean) to authenticated;

-- The project a group's row goes to: the group's house, or its sibling on the row's platform.
create or replace function public.whatsapp_group_project(p_group text, p_platform text)
returns uuid
language sql stable
set search_path = public
as $$
  select coalesce(
           case when lower(trim(coalesce(p_platform, ''))) in ('android', 'ios')
                 and p.platform is distinct from lower(trim(p_platform))
                 and p.house_group is not null
                then (select s.id from public.projects s
                       where s.house_group = p.house_group and s.platform = lower(trim(p_platform))
                       order by s.name limit 1)
           end,
           p.id)
    from public.whatsapp_groups g
    join public.projects p on p.id = g.project_id
   where g.group_key = public.project_name_key(trim(coalesce(p_group, '')))
     and not g.mixed
$$;

-- Rows with their group's project filled in (as project_id, marked via_group) where QA chose
-- nothing for the row and its house value doesn't name a house.
create or replace function public.whatsapp_apply_groups(p_rows jsonb)
returns jsonb
language sql stable
set search_path = public
as $$
  select case when jsonb_typeof(p_rows) is distinct from 'array' then p_rows else (
    select coalesce(jsonb_agg(
             case when nullif(e.r->>'project_id', '') is null
                   and g.gp is not null
                   and h.how is distinct from 'house'
                  then e.r || jsonb_build_object('project_id', g.gp, 'via_group', true)
                  else e.r end
             order by e.o), '[]'::jsonb)
      from jsonb_array_elements(p_rows) with ordinality as e(r, o)
      left join lateral (select public.whatsapp_group_project(e.r->>'whatsapp_group', e.r->>'platform') gp) g on true
      left join lateral (select f.how from public.whatsapp_find_project(e.r->>'house', null, e.r->>'platform') f) h on true
  ) end
$$;

-- In the result, rows filed by their group's house show how = 'group' (not 'chosen').
create or replace function public.whatsapp_mark_groups(p_rows jsonb, p_result jsonb)
returns jsonb
language sql stable
as $$
  select case when jsonb_typeof(p_result->'rows') is distinct from 'array' then p_result else
    p_result || jsonb_build_object('rows', (
      select coalesce(jsonb_agg(
               case when x.v->>'how' = 'chosen' and coalesce((p_rows->(x.o::int - 1)->>'via_group')::boolean, false)
                    then x.v || jsonb_build_object('how', 'group')
                    else x.v end
               order by x.o), '[]'::jsonb)
        from jsonb_array_elements(p_result->'rows') with ordinality as x(v, o)))
  end
$$;

revoke all on function public.whatsapp_group_project(text, text) from public, anon;
grant execute on function public.whatsapp_group_project(text, text) to authenticated;
revoke all on function public.whatsapp_apply_groups(jsonb) from public, anon, authenticated;
revoke all on function public.whatsapp_mark_groups(jsonb, jsonb) from public, anon, authenticated;

-- QA/admin entry point: as 0049, with the groups' houses.
create or replace function public.whatsapp_import(
  p_rows jsonb,
  p_create_projects boolean default true,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.is_qa_or_admin() then
    raise exception 'Only QA or an admin can import from WhatsApp.' using errcode = '42501';
  end if;
  v_rows := public.whatsapp_apply_groups(p_rows);
  return public.whatsapp_mark_groups(v_rows,
           public.whatsapp_explain_matches(v_rows,
             public.whatsapp_import_core(v_rows, p_create_projects, p_dry_run)));
end;
$$;

-- After each send from Grok: as 0049, with the groups' houses.
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
  v_rows := public.whatsapp_apply_groups(v_rows);
  v_res := public.whatsapp_mark_groups(v_rows,
             public.whatsapp_explain_matches(v_rows, public.whatsapp_import_core(v_rows, false, false)));
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
