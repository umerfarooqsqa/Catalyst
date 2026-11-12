-- =====================================================================
-- 0052: two intake senders, each with its own key.
--
-- Decided with the user (2026-10-05): besides the WhatsApp Bot (WHATSAPP_INTAKE_KEY), the
-- assistant that keeps the Google Sheet tracker POSTs its rows to /api/intake/whatsapp with its
-- own key (WHATSAPP_INTAKE_KEY_TRACKER), so either can be switched off without the other.
-- The route knows which key was used; whatsapp_inbox.sender records who last sent each row
-- ('whatsapp_bot' | 'tracker'), so QA can tell where a row (or a duplicate) came from.
-- The tracker's 76 items use their own item_ids (JS-016...), so an issue the Bot already sent
-- under another id is filed twice; QA deletes those (decided with the user).
-- =====================================================================

alter table public.whatsapp_inbox
  add column if not exists sender text check (sender in ('whatsapp_bot', 'tracker'));

-- Called by the intake route after whatsapp_inbox_upsert, with the item_ids it just sent.
create or replace function public.whatsapp_inbox_set_sender(p_item_ids text[], p_sender text)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare v integer;
begin
  update public.whatsapp_inbox set sender = p_sender where item_id = any (p_item_ids);
  get diagnostics v = row_count;
  return v;
end;
$$;

revoke all on function public.whatsapp_inbox_set_sender(text[], text) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.whatsapp_inbox_set_sender(text[], text) to service_role;
  end if;
end;
$$;
