-- =====================================================================
-- 0065: every Critical app warning is also a bug (2026-10-28, decided with the user)
--
-- The user: "the open in my queue critical is directing to empty bug list the bugs are not
-- logged there". A card in My Queue's Critical tab (app_warning_category = 'critical': Play
-- policy / suspension, a serious Play Console email, target API) opened the project's Bugs
-- page, where nothing about it existed. Chosen: "Log each as a bug".
--
--   * Each Critical card is filed once as a critical bug in its app's project (source
--     'app_monitor', automation_key 'app_warning:<warning id>', on the warning's version when
--     the portal has it, else the current version). The project's usual routing assigns it
--     (trg_bugs_default_assignee) and the assignee is told as for any new bug.
--   * app_warnings.bug_id points to it, and the card's "Open" goes to that bug.
--   * When the warning comes back (closed and cleared, then true again; or cleared while open,
--     then true again), a fixed / ready-for-retest / closed bug is reopened. A bug a person
--     deleted is filed again only when the warning comes back, never on a routine re-check.
--   * Nothing else changes: closing the card doesn't close the bug, and the bug's status
--     never closes the card. Other tabs (Crash & ANR rates, New crashes, Not critical, ...)
--     are not filed; "Critical bugs on live" already are bugs.
-- =====================================================================

alter table public.bugs drop constraint if exists bugs_source_check;
alter table public.bugs add constraint bugs_source_check
  check (source = any (array['manual', 'automation', 'whatsapp', 'app_monitor']));

alter table public.app_warnings add column if not exists bug_id uuid references public.bugs(id) on delete set null;
alter table public.app_warnings add column if not exists bug_filed_at timestamptz;
comment on column public.app_warnings.bug_id is
  'The bug this Critical warning was filed as (0065); the card''s Open goes there.';

-- File the warning as a bug, or reopen its bug when it came back (p_again). Returns the bug.
create or replace function public.app_warning_file_bug(p_id uuid, p_again boolean default false)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  w public.app_warnings;
  v_release uuid;
  v_bug uuid;
  v_app text := rtrim(public.email_config('email_app_url', 'https://catalyst.umerfarooqsqa.workers.dev'), '/');
begin
  select * into w from public.app_warnings where id = p_id for update;
  if not found then return null; end if;

  if w.bug_id is not null then
    if p_again then
      update public.bugs set status = 'reopened'
       where id = w.bug_id and status in ('fixed', 'ready_for_retest', 'closed');
    end if;
    return w.bug_id;
  end if;
  -- filed before and deleted by a person: only a comeback files it again
  if w.bug_filed_at is not null and not p_again then return null; end if;

  select rl.id into v_release from public.releases rl
   where rl.project_id = w.project_id and rl.version = w.data ->> 'version' limit 1;
  if v_release is null then
    select rl.id into v_release from public.releases rl join public.projects p on p.id = rl.project_id
     where rl.project_id = w.project_id and rl.version = p.current_version limit 1;
  end if;

  insert into public.bugs (project_id, title, description, severity, priority, status,
                           source, automation_key, release_id, created_by)
  values (w.project_id, w.title,
          concat_ws(E'\n\n',
            nullif(trim(coalesce(w.detail, '')), ''),
            'Found by catalyst''s app monitor (' || case w.source
                when 'target_api' then 'target API check'
                when 'releases' then 'Google Play releases'
                when 'play_email' then 'Play Console email'
                when 'vitals' then 'Android vitals'
                else w.source end
              || ') on ' || to_char(w.first_seen_at at time zone 'Asia/Karachi', 'DD Mon YYYY') || '.',
            case when w.action_url like 'http%' then 'Where to fix it: ' || w.action_url end,
            'App warning card: ' || v_app || '/my-queue#w-' || w.id),
          'critical', 'high', 'open',
          'app_monitor', 'app_warning:' || w.id, v_release, null)
  on conflict (project_id, automation_key) where automation_key is not null do nothing
  returning id into v_bug;
  if v_bug is null then
    -- the key is taken: a bug filed for this warning before (kept, so not deleted)
    select id into v_bug from public.bugs
     where project_id = w.project_id and automation_key = 'app_warning:' || w.id;
    if p_again then
      update public.bugs set status = 'reopened'
       where id = v_bug and status in ('fixed', 'ready_for_retest', 'closed');
    end if;
  end if;

  update public.app_warnings set bug_id = v_bug, bug_filed_at = coalesce(bug_filed_at, now()) where id = w.id;
  return v_bug;
end;
$$;
revoke all on function public.app_warning_file_bug(uuid, boolean) from public, anon, authenticated;
grant execute on function public.app_warning_file_bug(uuid, boolean) to service_role;

-- Every path that writes a warning (the monitor's sync, Play mail intake, a person assigning a
-- mail) goes through here. The function's own update touches neither column below.
create or replace function public.app_warnings_file_bug_trg()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.status <> 'open' or not new.active
     or public.app_warning_category(new.kind, new.severity, new.source, new.active) <> 'critical' then
    return null;
  end if;
  if tg_op = 'UPDATE' and (old.status = 'closed' or not old.active) then
    perform public.app_warning_file_bug(new.id, true);   -- it came back
  elsif new.bug_filed_at is null then
    perform public.app_warning_file_bug(new.id, false);  -- new, or just became Critical
  end if;
  return null;
end;
$$;

drop trigger if exists trg_app_warnings_file_bug on public.app_warnings;
create trigger trg_app_warnings_file_bug
  after insert or update of status, active, severity, kind, source, project_id on public.app_warnings
  for each row execute function public.app_warnings_file_bug_trg();

-- the Critical cards open now
select public.app_warning_file_bug(id)
  from public.app_warnings
 where status = 'open' and active and bug_filed_at is null
   and public.app_warning_category(kind, severity, source, active) = 'critical'
 order by first_seen_at;
