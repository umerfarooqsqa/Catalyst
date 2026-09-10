-- =====================================================================
-- CATALYST IT SOLUTIONS — Task & Bug Tracking System
-- Supabase (PostgreSQL) schema script
-- Run this in: Supabase Dashboard -> SQL Editor -> New query
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. EXTENSIONS
-- ---------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------
-- 1. ENUM TYPES
-- ---------------------------------------------------------------------
create type user_role as enum ('admin', 'qa', 'dev_app', 'dev_web', 'viewer');
create type bug_severity as enum ('critical', 'major', 'minor', 'trivial');
create type bug_priority as enum ('high', 'medium', 'low');
create type bug_status as enum ('open', 'in_progress', 'fixed', 'ready_for_retest', 'reopened', 'closed');
create type task_status as enum ('todo', 'in_progress', 'blocked', 'done');
create type requirement_status as enum ('draft', 'active', 'deprecated');
create type test_case_status as enum ('pending', 'pass', 'fail');
create type notification_type as enum ('assignment', 'status_change', 'comment', 'sla_breach', 'retest_ready');

-- ---------------------------------------------------------------------
-- 2. PROFILES (extends Supabase auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null unique,
  full_name       text not null,
  role            user_role not null default 'viewer',
  specialty       text,                        -- e.g. 'app' or 'web', only meaningful for dev roles
  avatar_url      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'viewer')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------
-- 3. PROJECTS (one per app being tested)
-- ---------------------------------------------------------------------
create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.project_members (
  project_id      uuid not null references public.projects(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  role_override   user_role,                   -- optional per-project role override
  added_at        timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- ---------------------------------------------------------------------
-- 4. REQUIREMENTS -> TEST CASES (traceability)
-- ---------------------------------------------------------------------
create table public.requirements (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  title           text not null,
  description     text,
  status          requirement_status not null default 'draft',
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.test_cases (
  id              uuid primary key default gen_random_uuid(),
  requirement_id  uuid not null references public.requirements(id) on delete cascade,
  title           text not null,
  steps           text,
  expected_result text,
  actual_result   text,
  status          test_case_status not null default 'pending',
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. BUG CATEGORIES (for templates)
-- ---------------------------------------------------------------------
create table public.bug_categories (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null unique,       -- e.g. 'Login Flow', 'Payment', 'UI/Layout'
  default_severity      bug_severity default 'minor',
  template_steps        text,                        -- pre-filled steps-to-reproduce structure
  keyword_hints         text[],                       -- keywords used for auto-severity suggestion
  created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. MASTER BUG LIBRARY (shared across all projects, reusable)
-- ---------------------------------------------------------------------
create table public.master_bugs (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  description         text,
  steps_to_reproduce  text,
  severity            bug_severity not null default 'minor',
  category_id         uuid references public.bug_categories(id),
  tags                text[],
  times_reused        integer not null default 0,
  last_reused_at      timestamptz,
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Full-text search index for the Master Bug Library search bar
create index master_bugs_search_idx on public.master_bugs
  using gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(steps_to_reproduce,'')));

create index master_bugs_title_trgm_idx on public.master_bugs using gin (title gin_trgm_ops); -- powers fast "live suggest while typing"

-- ---------------------------------------------------------------------
-- 7. BUGS (per-project sheets, same headings as master_bugs + extras)
-- ---------------------------------------------------------------------
create table public.bugs (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  title               text not null,
  description         text,
  steps_to_reproduce  text,
  severity            bug_severity not null default 'minor',
  priority            bug_priority not null default 'medium',
  status              bug_status not null default 'open',
  category_id         uuid references public.bug_categories(id),
  requirement_id      uuid references public.requirements(id),   -- requirement this bug violates
  master_bug_id       uuid references public.master_bugs(id),    -- history: which master entry it was copied from (not a live link)
  assignee_id         uuid references public.profiles(id),
  due_date            date,
  sla_deadline         timestamptz,                                -- computed at creation/assignment from sla_settings
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  closed_at           timestamptz
);

create index bugs_project_idx on public.bugs(project_id);
create index bugs_assignee_idx on public.bugs(assignee_id);
create index bugs_status_idx on public.bugs(status);
create index bugs_severity_idx on public.bugs(severity);
create index bugs_search_idx on public.bugs
  using gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')));

-- ---------------------------------------------------------------------
-- 8. TASKS (open backlog, due dates, no sprints)
-- ---------------------------------------------------------------------
create table public.tasks (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  title           text not null,
  description     text,
  status          task_status not null default 'todo',
  priority        bug_priority not null default 'medium',
  assignee_id     uuid references public.profiles(id),
  linked_bug_id   uuid references public.bugs(id),
  due_date        date,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index tasks_project_idx on public.tasks(project_id);
create index tasks_assignee_idx on public.tasks(assignee_id);
create index tasks_status_idx on public.tasks(status);
create index tasks_due_date_idx on public.tasks(due_date);

-- ---------------------------------------------------------------------
-- 9. ATTACHMENTS (bugs & tasks)
-- ---------------------------------------------------------------------
create table public.attachments (
  id              uuid primary key default gen_random_uuid(),
  bug_id          uuid references public.bugs(id) on delete cascade,
  task_id         uuid references public.tasks(id) on delete cascade,
  file_path       text not null,       -- path within Supabase Storage bucket
  file_name       text not null,
  file_size_bytes bigint,
  uploaded_by     uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  constraint attachment_parent_check check (
    (bug_id is not null and task_id is null) or (bug_id is null and task_id is not null)
  )
);

-- ---------------------------------------------------------------------
-- 10. COMMENTS (bugs & tasks)
-- ---------------------------------------------------------------------
create table public.comments (
  id              uuid primary key default gen_random_uuid(),
  bug_id          uuid references public.bugs(id) on delete cascade,
  task_id         uuid references public.tasks(id) on delete cascade,
  author_id       uuid references public.profiles(id),
  content         text not null,
  created_at      timestamptz not null default now(),
  constraint comment_parent_check check (
    (bug_id is not null and task_id is null) or (bug_id is null and task_id is not null)
  )
);

-- ---------------------------------------------------------------------
-- 11. NOTIFICATIONS
-- ---------------------------------------------------------------------
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  type            notification_type not null,
  message         text not null,
  related_bug_id  uuid references public.bugs(id) on delete cascade,
  related_task_id uuid references public.tasks(id) on delete cascade,
  is_read         boolean not null default false,
  created_at      timestamptz not null default now()
);

create index notifications_user_unread_idx on public.notifications(user_id, is_read);

-- ---------------------------------------------------------------------
-- 12. SLA SETTINGS (global defaults + per-project overrides, Admin-editable)
-- ---------------------------------------------------------------------
create table public.sla_settings (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid references public.projects(id) on delete cascade,  -- NULL = global default
  severity        bug_severity not null,
  threshold_hours integer not null,
  created_at      timestamptz not null default now(),
  unique (project_id, severity)
);

-- System-wide default SLA thresholds (project_id = NULL)
insert into public.sla_settings (project_id, severity, threshold_hours) values
  (null, 'critical', 24),
  (null, 'major',    72),
  (null, 'minor',    168),
  (null, 'trivial',  336);

-- ---------------------------------------------------------------------
-- 13. updated_at AUTO-TOUCH TRIGGER (applied to all tables that have it)
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_profiles_updated before update on public.profiles
  for each row execute procedure public.touch_updated_at();
create trigger trg_projects_updated before update on public.projects
  for each row execute procedure public.touch_updated_at();
create trigger trg_requirements_updated before update on public.requirements
  for each row execute procedure public.touch_updated_at();
create trigger trg_test_cases_updated before update on public.test_cases
  for each row execute procedure public.touch_updated_at();
create trigger trg_master_bugs_updated before update on public.master_bugs
  for each row execute procedure public.touch_updated_at();
create trigger trg_bugs_updated before update on public.bugs
  for each row execute procedure public.touch_updated_at();
create trigger trg_tasks_updated before update on public.tasks
  for each row execute procedure public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 14. ENABLE ROW LEVEL SECURITY (policies to be refined once app roles
--     are wired up — this locks tables down by default so nothing is
--     publicly readable/writable until explicit policies are added)
-- ---------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.projects         enable row level security;
alter table public.project_members  enable row level security;
alter table public.requirements     enable row level security;
alter table public.test_cases       enable row level security;
alter table public.bug_categories   enable row level security;
alter table public.master_bugs      enable row level security;
alter table public.bugs             enable row level security;
alter table public.tasks            enable row level security;
alter table public.attachments      enable row level security;
alter table public.comments         enable row level security;
alter table public.notifications    enable row level security;
alter table public.sla_settings     enable row level security;

-- Baseline policy: any authenticated user can read profiles (needed for
-- assignee dropdowns etc.) — refine further once roles are in place.
create policy "Authenticated users can view profiles"
  on public.profiles for select
  using (auth.role() = 'authenticated');

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- NOTE: Full role-based policies (Admin/QA/Dev/Viewer permissions per
-- table) are intentionally left for a follow-up script once the app's
-- auth/role wiring is in place — enabling RLS now just prevents any
-- open/public access in the meantime.

-- =====================================================================
-- END OF SCRIPT
-- =====================================================================
