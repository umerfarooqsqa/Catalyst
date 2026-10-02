-- =====================================================================
-- 0045: the address each person's bug emails go to.
--
-- Decided with the user (2026-10-02): every login is a @catalyst.com address, which nobody
-- here receives mail at, so emails go to an address added for the person instead (usually
-- their Gmail). The person adds it on the Notifications page, or an admin on Admin -> Users
-- (also when creating the user). Nobody else can read it.
--
-- Someone with no address gets NO email (the bell is unchanged). Changing the address moves
-- their pending bugs and queued emails to it; removing it drops them.
--
-- Replaces public.email_enqueue() (0044): the recipient is notification_emails.email, not
-- profiles.email. Everything else in 0044 is unchanged.
-- =====================================================================

create table if not exists public.notification_emails (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  email      text not null
               check (length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.notification_emails enable row level security;
drop policy if exists notification_emails_select on public.notification_emails;
create policy notification_emails_select on public.notification_emails
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists notification_emails_insert on public.notification_emails;
create policy notification_emails_insert on public.notification_emails
  for insert to authenticated with check (user_id = auth.uid() or public.is_admin());
drop policy if exists notification_emails_update on public.notification_emails;
create policy notification_emails_update on public.notification_emails
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
drop policy if exists notification_emails_delete on public.notification_emails;
create policy notification_emails_delete on public.notification_emails
  for delete to authenticated using (user_id = auth.uid() or public.is_admin());

-- Stored trimmed and lower-case, so the pending queue (keyed by address) groups correctly.
create or replace function public.notification_emails_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.email := lower(trim(new.email));
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists trg_notification_emails_normalize on public.notification_emails;
create trigger trg_notification_emails_normalize
  before insert or update on public.notification_emails
  for each row execute function public.notification_emails_normalize();

-- A changed address takes over the person's pending bugs and queued emails; a removed one drops them.
create or replace function public.notification_emails_moved()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
begin
  if tg_op = 'DELETE' then
    delete from public.email_pending where recipient_id = v_user;
    delete from public.email_outbox where recipient_id = v_user and status = 'queued';
    return old;
  end if;
  if tg_op = 'UPDATE' and new.email is distinct from old.email then
    insert into public.email_pending (recipient_id, recipient_email, project_id, bug_id, event_type, created_at, updated_at)
    select recipient_id, new.email, project_id, bug_id, event_type, created_at, updated_at
      from public.email_pending
     where recipient_id = v_user and recipient_email <> new.email
    on conflict (recipient_email, bug_id) do nothing;
    delete from public.email_pending where recipient_id = v_user and recipient_email <> new.email;
    update public.email_outbox set recipient_email = new.email
     where recipient_id = v_user and status = 'queued';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notification_emails_moved on public.notification_emails;
create trigger trg_notification_emails_moved
  after update or delete on public.notification_emails
  for each row execute function public.notification_emails_moved();

-- 0044's entry point, now addressed to notification_emails.
create or replace function public.email_enqueue(p_user uuid, p_bug uuid, p_event text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_email    text;
  v_project  uuid;
  v_severity public.bug_severity;
  v_mode     text;
  v_critical boolean;
begin
  select email into v_email from public.notification_emails where user_id = p_user;
  if v_email is null then
    return;                              -- no address added: bell only
  end if;
  if exists (select 1 from public.email_opt_outs
             where user_id = p_user and event_type in ('all', p_event)) then
    return;
  end if;

  select project_id, severity into v_project, v_severity from public.bugs where id = p_bug;
  if v_project is null then
    return;
  end if;
  v_mode := coalesce((select mode from public.project_email_settings where project_id = v_project), 'auto_batch');
  v_critical := v_severity = 'critical';

  if v_critical or v_mode = 'instant' then
    -- This email shows the bug's latest state, so a pending row for it would only repeat it.
    delete from public.email_pending where recipient_email = v_email and bug_id = p_bug;
    insert into public.email_outbox (recipient_id, recipient_email, kind, priority, items)
    values (p_user, v_email,
            case when v_critical then 'critical' else 'instant' end,
            case when v_critical then 0 else 5 end,
            jsonb_build_array(public.email_bug_item(p_bug, p_event)));
    return;
  end if;

  insert into public.email_pending (recipient_id, recipient_email, project_id, bug_id, event_type)
  values (p_user, v_email, v_project, p_bug, p_event)
  on conflict (recipient_email, bug_id) do update
    set event_type = excluded.event_type,
        project_id = excluded.project_id,
        updated_at = public.email_now();

  if v_mode = 'auto_batch' then
    perform public.email_maybe_flush(v_email);
  end if;
end;
$$;

revoke all on function public.email_enqueue(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.notification_emails_moved() from public, anon, authenticated;
revoke all on function public.notification_emails_normalize() from public, anon, authenticated;
