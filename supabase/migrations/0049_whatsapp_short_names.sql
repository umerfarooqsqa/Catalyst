-- =====================================================================
-- 0049: WhatsApp rows find a project by its short name; rows naming several apps say which.
--
-- Decided with the user (2026-10-05). Grok sent app_name "D-Trade / Wiqaya" with house
-- "unknown" (one issue in two apps). It matched nothing and was held with
-- 'no project for "D-Trade / Wiqaya"', although "MRA D-Trade" and "MRA Wiqaya" both exist:
-- 0046 only compared the WHOLE name's key ("dtradewiqaya") against each project's keys
-- ("mradtrade", "mrawiqaya", ...). Even "Wiqaya" alone would not have matched.
--
-- whatsapp_find_project() keeps its contract (house first, then the whole name exactly, as
-- in 0046), and when that finds nothing it now also tries:
--   * each part of the name, split on "/", ",", "&", "+", "|" and the word "and";
--   * per part: the project keys as before, else whole words of the project's name
--     ("Wiqaya" -> "MRA Wiqaya", "D-Trade" -> "MRA D-Trade"; project_short_keys()).
--     Words shorter than 4 characters or generic ones ("Trade", "Securities", "Limited"...)
--     never match on their own, and a word in several projects' names ("Habib") matches
--     all of them, so it is ambiguous. The row's platform is preferred, as before.
--   * every part must point to the same single project. Parts naming different projects,
--     one part matching several projects, or a part matching nothing while another matches
--     -> 'ambiguous': the row waits for QA, never guessed. If no part matches anything the
--     result is 'none', as before.
-- whatsapp_import() and whatsapp_auto_import() then replace the reason of an ambiguous row
-- with what each part matched, e.g.
--   more than one project matches ("D-Trade" -> MRA D-Trade; "Wiqaya" -> MRA Wiqaya):
--   send one row per house, or choose one
-- so Grok and QA see the projects exist. whatsapp_import_core() is unchanged; how stays
-- 'ambiguous', so the import page still offers the project picker for these rows.
-- One WhatsApp item is still filed in one project (whatsapp_items.item_id is unique): an
-- issue in two apps is two rows, one per house.
-- =====================================================================

-- The parts of a row's app name: "D-Trade / Wiqaya" -> {D-Trade, Wiqaya}. Hyphens don't split.
create or replace function public.whatsapp_name_parts(p_name text)
returns text[]
language sql immutable
as $$
  select coalesce(array_agg(trim(s.t) order by s.o), '{}')
  from regexp_split_to_table(coalesce(p_name, ''), '\s*(?:/|,|&|\+|\||\mand\M)\s*', 'i')
       with ordinality as s(t, o)
  where s.t ~ '[[:alnum:]]'
$$;

-- A project's short names: every run of whole words in its name, without brackets:
-- "MRA D-Trade (iOS)" -> {dtrade}, "HMFS Insta Trade" -> {hmfs, hmfsinsta, insta, instatrade}.
-- Any run, not only the last words, so a word in several projects' names ("Habib") matches
-- all of them and stays ambiguous instead of picking the one where it happens to come last.
-- The whole name is in project_keys() already. Runs shorter than 4 characters, and runs of
-- only generic words ("Trade", "Securities Limited"), are left out.
create or replace function public.project_short_keys(p_name text)
returns text[]
language sql immutable
as $$
  with g as (
    select array['trade', 'trader', 'traders', 'trading', 'securities', 'capital', 'investments', 'investment',
                 'financial', 'finance', 'services', 'limited', 'market', 'markets', 'brokerage', 'group',
                 'company', 'pakistan', 'mobile', 'desktop', 'online', 'plus', 'tick', 'shariah', 'islamic',
                 'android', 'portal', 'nxg', 'pro', 'app', 'ios', 'web'] s
  ), w as (
    select regexp_split_to_array(trim(regexp_replace(coalesce(p_name, ''), '\([^()]*\)', ' ', 'g')), '\s+') a
  ), runs as (
    select public.project_name_key(array_to_string(w.a[i:j], ' ')) k,
           (select bool_and(public.project_name_key(x) = any (g.s)) from unnest(w.a[i:j]) x) generic
      from w, g, generate_series(1, coalesce(array_length(w.a, 1), 0)) i,
           generate_series(i, coalesce(array_length(w.a, 1), 0)) j
     where not (i = 1 and j = array_length(w.a, 1))
  )
  select coalesce(array_agg(distinct k order by k), '{}')
    from runs
   where length(k) >= 4 and k ~ '^[a-z0-9]+$' and not generic
$$;

-- The projects one name part points to: exact keys first, else short names; only the best
-- platform rank (the row's, else Android, else none, else the other). Empty = none.
create or replace function public.whatsapp_match_part(p_part text, p_platform text)
returns uuid[]
language plpgsql stable
set search_path = public
as $$
declare
  v_key  text := public.project_name_key(p_part);
  v_plat text := case when lower(trim(coalesce(p_platform, ''))) in ('android', 'ios')
                      then lower(trim(p_platform)) end;
  v_ids  uuid[];
begin
  if v_key is null or v_key !~ '^[a-z0-9]+$' then
    return '{}';
  end if;
  select array_agg(s.id) into v_ids from (
    select p.id, rank() over (order by case when v_plat is not null and p.platform = v_plat then 0
                                            when p.platform = 'android' then 1
                                            when p.platform is null then 2 else 3 end) rk
      from public.projects p
     where v_key = any (public.project_keys(p.name, p.house_slug, p.house_group))
  ) s where s.rk = 1;
  if v_ids is null and length(v_key) >= 4 then
    select array_agg(s.id) into v_ids from (
      select p.id, rank() over (order by case when v_plat is not null and p.platform = v_plat then 0
                                              when p.platform = 'android' then 1
                                              when p.platform is null then 2 else 3 end) rk
        from public.projects p
       where v_key = any (public.project_short_keys(p.name))
    ) s where s.rk = 1;
  end if;
  return coalesce(v_ids, '{}');
end;
$$;

-- The project for a row: by house first, then by name. how = house | name | ambiguous | none.
create or replace function public.whatsapp_find_project(p_house text, p_app text, p_platform text)
returns table (project_id uuid, project_name text, how text)
language plpgsql stable
set search_path = public
as $$
declare
  v_house  text := lower(nullif(trim(coalesce(p_house, '')), ''));
  v_plat   text := case when lower(trim(coalesce(p_platform, ''))) in ('android', 'ios')
                        then lower(trim(p_platform)) end;
  v_key    text;
  v_src    text;
  v_part   text;
  v_parts  text[];
  v_ids    uuid[];
  v_found  uuid[];
  v_rank    integer;
  v_none    boolean;
  v_several boolean;
begin
  if v_house in ('unknown', 'internal', 'none', 'n/a', '-') then
    v_house := null;
  end if;

  -- 1. by house (unchanged from 0046)
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

  -- 2. by the whole name: the app name, else a house value that isn't a known slug (unchanged)
  foreach v_key in array array[public.project_name_key(p_app), public.project_name_key(v_house)] loop
    continue when v_key is null or v_key = '';
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

  -- 3. by the name's parts and short names (0049); every part must point to the same project
  foreach v_src in array array[p_app, v_house] loop
    continue when v_src is null;
    v_parts := public.whatsapp_name_parts(v_src);
    continue when coalesce(array_length(v_parts, 1), 0) = 0;
    v_found := '{}';
    v_none := false;
    v_several := false;
    foreach v_part in array v_parts loop
      v_ids := public.whatsapp_match_part(v_part, p_platform);
      case coalesce(array_length(v_ids, 1), 0)
        when 0 then v_none := true;
        when 1 then
          if not v_ids[1] = any (v_found) then v_found := v_found || v_ids[1]; end if;
        else v_several := true;
      end case;
    end loop;
    if not v_none and not v_several and cardinality(v_found) = 1 then
      return query select p.id, p.name, 'name'::text from public.projects p where p.id = v_found[1];
      return;
    end if;
    if v_several or cardinality(v_found) > 0 then
      return query select null::uuid, null::text, 'ambiguous'::text;
      return;
    end if;
    -- no part matched anything: try the house value, then give up as before
  end loop;

  return query select null::uuid, null::text, 'none'::text;
end;
$$;

-- What each part of an ambiguous row matched, as its reason. p_result is whatsapp_import_core()'s
-- result for p_rows: one result row per sheet row, in the same order.
create or replace function public.whatsapp_explain_matches(p_rows jsonb, p_result jsonb)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  v_out   jsonb := '[]'::jsonb;
  v_x     jsonb;
  v_r     jsonb;
  v_i     bigint;
  v_house text;
  v_src   text;
  v_parts text[];
  v_desc  text;
begin
  if jsonb_typeof(p_result->'rows') is distinct from 'array' then
    return p_result;
  end if;
  for v_x, v_i in select value, ordinality from jsonb_array_elements(p_result->'rows') with ordinality loop
    v_r := p_rows->(v_i::int - 1);
    if v_x->>'how' = 'ambiguous' and v_x->>'action' = 'skip' and v_r is not null then
      v_house := lower(nullif(trim(coalesce(v_r->>'house', '')), ''));
      if v_house in ('unknown', 'internal', 'none', 'n/a', '-') then v_house := null; end if;
      -- the value whatsapp_find_project decided on: the app name, unless none of its parts
      -- matched anything and the house value did
      v_src := nullif(trim(coalesce(v_r->>'app_name', '')), '');
      if v_src is null
         or (v_house is not null
             and not exists (select 1 from unnest(public.whatsapp_name_parts(v_src)) x
                              where cardinality(public.whatsapp_match_part(x, v_r->>'platform')) > 0)) then
        v_src := coalesce(v_house, v_src);
      end if;
      v_parts := public.whatsapp_name_parts(v_src);
      if coalesce(array_length(v_parts, 1), 0) > 0 then
        select string_agg(format('"%s" -> %s', x.part,
                 coalesce((select string_agg(p.name, ', ' order by p.name) from public.projects p
                            where p.id = any (public.whatsapp_match_part(x.part, v_r->>'platform'))),
                          'no project')), '; ' order by x.o)
          into v_desc
          from unnest(v_parts) with ordinality as x(part, o);
        v_x := v_x || jsonb_build_object('reason', format('more than one project matches (%s): %s',
                 v_desc,
                 case when array_length(v_parts, 1) > 1 then 'send one row per house, or choose one'
                      else 'choose one' end));
      end if;
    end if;
    v_out := v_out || jsonb_build_array(v_x);
  end loop;
  return p_result || jsonb_build_object('rows', v_out);
end;
$$;

revoke all on function public.whatsapp_match_part(text, text) from public, anon;
grant execute on function public.whatsapp_match_part(text, text) to authenticated;
revoke all on function public.whatsapp_explain_matches(jsonb, jsonb) from public, anon, authenticated;

-- QA/admin entry point: as 0048, with the explained reasons.
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
  return public.whatsapp_explain_matches(p_rows,
           public.whatsapp_import_core(p_rows, p_create_projects, p_dry_run));
end;
$$;

-- After each send from Grok: as 0048, with the explained reasons.
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
  v_res := public.whatsapp_explain_matches(v_rows, public.whatsapp_import_core(v_rows, false, false));
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
