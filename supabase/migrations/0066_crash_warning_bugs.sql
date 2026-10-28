-- =====================================================================
-- 0066: crash/ANR rate and new-crash cards are bugs too (2026-10-28, the user: "also log crash
-- rates and new crashes as bugs")
--
-- 0065 filed only the Critical tab. The "Crash & ANR rates" tab (red crash_rate, anr_rate,
-- *_device) and the "New crashes in live build" tab (red new_crash) are now filed the same way:
-- once per card, reopened when the warning comes back, the card opens its bug. A new crash's
-- Play Console issue link is in the bug as "Where to fix it".
-- =====================================================================

create or replace function public.app_warning_files_bug(p_kind text, p_severity text, p_source text, p_active boolean)
returns boolean
language sql immutable
set search_path = public
as $$
  select public.app_warning_category(p_kind, p_severity, p_source, p_active) in ('critical', 'rates', 'new_crashes');
$$;
grant execute on function public.app_warning_files_bug(text, text, text, boolean) to authenticated, service_role;

create or replace function public.app_warnings_file_bug_trg()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.status <> 'open' or not new.active
     or not public.app_warning_files_bug(new.kind, new.severity, new.source, new.active) then
    return null;
  end if;
  if tg_op = 'UPDATE' and (old.status = 'closed' or not old.active) then
    perform public.app_warning_file_bug(new.id, true);   -- it came back
  elsif new.bug_filed_at is null then
    perform public.app_warning_file_bug(new.id, false);  -- new, or just turned red
  end if;
  return null;
end;
$$;

-- the rate and new-crash cards open now
select public.app_warning_file_bug(id)
  from public.app_warnings
 where status = 'open' and active and bug_filed_at is null
   and public.app_warning_files_bug(kind, severity, source, active)
 order by first_seen_at;
