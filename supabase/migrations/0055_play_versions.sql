-- =====================================================================
-- 0055: Google Play release facts per Android project, from the aktrade runner.
--
-- Once a day the runner reads every Android app's Play tracks (read-only Play
-- Developer API, aktrade utils/play_snapshot.py) and sends one row per project:
--   POST /api/automation/play-versions  -> this row, upserted on project_id
--   live      = the production release users get today (status completed)
--   upcoming  = a production draft, staged rollout or halted rollout newer than
--               live (alpha/beta/internal builds are not "upcoming")
-- Only facts are stored. Whether they are a problem is worked out on every page
-- load against projects.current_version (lib/play-version.ts), so the admin My
-- Queue's red "version mismatch" cards follow a version change in the portal at
-- once, without waiting for the next snapshot.
--
-- Visibility follows the other automation tables (0034, 0036): people who can
-- see the project, except contributor-level roles (developers). All writes go
-- through the service role.
-- =====================================================================

create table if not exists public.play_versions (
  project_id         uuid primary key references public.projects(id) on delete cascade,
  package            text not null,
  play_key           text,                -- which runner key (Play developer account) read it
  reachable          boolean not null default true,
  error              text,
  live_version       text,
  live_code          integer,
  upcoming_version   text,
  upcoming_code      integer,
  upcoming_track     text,
  upcoming_status    text,
  upcoming_fraction  numeric,
  snapshot_date      date,
  checked_at         timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

drop trigger if exists trg_play_versions_updated on public.play_versions;
create trigger trg_play_versions_updated before update on public.play_versions
  for each row execute procedure public.touch_updated_at();

alter table public.play_versions enable row level security;
drop policy if exists play_versions_select on public.play_versions;
create policy play_versions_select on public.play_versions
  for select to authenticated
  using (not public.is_contributor() and public.can_see_project(project_id));
