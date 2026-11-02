-- =====================================================================
-- 0068: deleting a user works again (2026-11-02, the user: "i am unable to delete users from
-- portal")
--
-- Admin -> Users -> delete removes the auth user; profiles cascade, and every reference to the
-- person is cleared (on delete set null) or deleted with them. Two guard triggers refused that
-- clearing:
--   * comments_on_edit (0034) lets only a comment's text change, so author_id -> NULL was
--     refused for anyone who ever commented, and the whole delete failed ("Database error
--     deleting user"). Now the author may become NULL (the comment stays, shown without an
--     author); changing it to someone else is still refused.
--   * bugs_version_confirmation (0037) keeps who confirmed a bug's version, so when the
--     confirmer was deleted it put their id back. That didn't fail (Postgres skips the
--     foreign-key check when the value is unchanged) but left the deleted person's id on the
--     bug. Now a confirmer whose profile is gone is cleared (the confirmation time stays).
-- No other trigger on the referencing tables refuses the clearing (checked on the live
-- database: projects_check_developer, bugs_enforce_developer_rights, tasks_enforce_approval and
-- tasks_enforce_delegation all let it through).
-- =====================================================================

create or replace function public.comments_on_edit()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.bug_id is distinct from old.bug_id or new.task_id is distinct from old.task_id
     or (new.author_id is distinct from old.author_id and new.author_id is not null)
     or new.created_at is distinct from old.created_at then
    raise exception 'Only a comment''s text can be edited.' using errcode = '42501';
  end if;
  if new.content is distinct from old.content then
    new.edited_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.comments_on_edit() from public, anon, authenticated;

create or replace function public.bugs_version_confirmation()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_was timestamptz := case when tg_op = 'UPDATE' then old.version_confirmed_at end;
begin
  if tg_op = 'UPDATE' and new.release_id is distinct from old.release_id then
    new.version_confirmed_at := null;
    new.version_confirmed_by := null;
    return new;
  end if;
  if new.version_confirmed_at is null then
    new.version_confirmed_by := null;
    return new;
  end if;
  if new.release_id is null then
    raise exception 'A bug with no app version cannot be confirmed. Set its version first.'
      using errcode = '23514';
  end if;
  if v_was is null then  -- being confirmed now
    new.version_confirmed_at := now();
    new.version_confirmed_by := auth.uid();  -- null for the service role
  else                   -- already confirmed: keep who and when
    new.version_confirmed_at := v_was;
    new.version_confirmed_by := case
      -- the confirmer's account was deleted (on delete set null): let it clear
      when new.version_confirmed_by is null
           and not exists (select 1 from public.profiles where id = old.version_confirmed_by) then null
      else old.version_confirmed_by end;
  end if;
  return new;
end;
$$;
revoke all on function public.bugs_version_confirmation() from public, anon, authenticated;
