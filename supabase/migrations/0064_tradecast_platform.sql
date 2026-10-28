-- =====================================================================
-- 0064: Tradecast, a separate area (2026-10-28, decided with the user)
--
-- The user: "create a separate master bug portal and separate projects section for
-- tradecast". Decided:
--   - a fully separate area: its own projects list (/tradecast), its own Bug Library
--     (/tradecast/library) and its own sidebar section; the main Projects list and Bug
--     Library don't show Tradecast;
--   - seen by the Tradecast team and by admins/QA: a role whose platform is 'tradecast' sees
--     only Tradecast; Android/iOS developers don't see it;
--   - no projects yet (QA creates them) and an empty Bug Library.
--
-- It is a third value of the platform columns, so the visibility rules of 0034/0043
-- (user_platform, can_see_project, base_page_select, ...) apply to it unchanged. Automation
-- (runners, jobs) stays Android/iOS.
-- =====================================================================

-- the platform checks from 0023 (projects), 0026 (base_page) and 0034 (roles), whatever
-- their generated names, are replaced by ones that also allow 'tradecast'
do $$
declare
  c record;
begin
  for c in
    select con.conname, rel.relname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname in ('projects', 'base_page', 'roles')
       and con.contype = 'c'
       -- only the plain "platform in (...)" checks; nothing else that mentions platform
       and pg_get_constraintdef(con.oid) like 'CHECK ((platform = ANY (ARRAY[%'
  loop
    execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
  end loop;
end;
$$;

alter table public.projects  add constraint projects_platform_check  check (platform in ('android', 'ios', 'tradecast'));
alter table public.base_page add constraint base_page_platform_check check (platform in ('android', 'ios', 'tradecast'));
alter table public.roles     add constraint roles_platform_check     check (platform in ('android', 'ios', 'tradecast'));

-- the Tradecast team's role: developers who see only Tradecast (admins give it on Admin -> Users)
insert into public.roles (key, label, level, assignable, is_default, sort_order, platform)
values ('tradecast', 'Tradecast', 'contributor', true, false, 60, 'tradecast')
on conflict (key) do nothing;
