-- =====================================================================
-- 0011 — Configurable roles.
-- Replaces the fixed `user_role` enum with a `roles` table an admin can
-- add to (Android, iOS, Backoffice, …). Each role has a permission
-- *level* that drives RLS, plus an "appears in assignee lists" flag.
--
--   level  admin       -> full control (users, roles, SLA, projects, all sheets)
--          manager     -> log bugs, write requirements, manage projects + tasks
--          contributor -> gets assigned bugs/tasks, edits their own
--          viewer      -> read-only
-- =====================================================================

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,          -- immutable slug; profiles.role FKs this
  label       text not null,                 -- editable display name
  level       text not null check (level in ('admin','manager','contributor','viewer')),
  assignable  boolean not null default true, -- shows in assignee pickers
  is_default  boolean not null default false,
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index roles_one_default on public.roles (is_default) where is_default;
create trigger trg_roles_updated before update on public.roles
  for each row execute procedure public.touch_updated_at();

insert into public.roles (key, label, level, assignable, is_default, sort_order) values
  ('admin',      'Admin',      'admin',       false, false, 10),
  ('qa',         'QA',         'manager',     true,  false, 20),
  ('backoffice', 'Backoffice', 'manager',     true,  false, 30),
  ('android',    'Android',    'contributor', true,  false, 40),
  ('ios',        'iOS',        'contributor', true,  false, 50),
  ('viewer',     'Viewer',     'viewer',      false, true,  90);

-- ---------------------------------------------------------------------
-- profiles.role : user_role enum -> text FK to roles(key)
-- ---------------------------------------------------------------------
alter table public.profiles alter column role drop default;
alter table public.profiles alter column role type text using role::text;
-- map the old dev roles to the new device roles
update public.profiles set role = 'android' where role = 'dev_app';
update public.profiles set role = 'ios'     where role = 'dev_web';
update public.profiles set role = 'viewer'  where role not in (select key from public.roles);
alter table public.profiles alter column role set default 'viewer';
alter table public.profiles
  add constraint profiles_role_fkey foreign key (role) references public.roles(key);

alter table public.profiles drop column if exists specialty;
alter table public.project_members drop column if exists role_override;

-- ---------------------------------------------------------------------
-- RLS helper functions — same names, new bodies (level via roles join).
-- Every existing policy keeps working unchanged.
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select r.level = 'admin'
       from public.profiles p join public.roles r on r.key = p.role
       where p.id = auth.uid()), false) $$;

create or replace function public.is_qa_or_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select r.level in ('admin','manager')
       from public.profiles p join public.roles r on r.key = p.role
       where p.id = auth.uid()), false) $$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select r.level in ('admin','manager','contributor')
       from public.profiles p join public.roles r on r.key = p.role
       where p.id = auth.uid()), false) $$;

drop function if exists public.current_user_role();
drop type if exists public.user_role;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_qa_or_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;

-- ---------------------------------------------------------------------
-- New signups get the default role.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_role text;
begin
  select key into v_role from public.roles
   where key = (new.raw_user_meta_data->>'role');
  if v_role is null then
    select key into v_role from public.roles where is_default limit 1;
  end if;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(v_role, 'viewer')
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- roles RLS — everyone reads, admin writes.
-- ---------------------------------------------------------------------
alter table public.roles enable row level security;
create policy "roles_select" on public.roles
  for select to authenticated using (true);
create policy "roles_admin_write" on public.roles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
