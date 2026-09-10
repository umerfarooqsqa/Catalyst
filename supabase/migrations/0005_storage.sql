-- =====================================================================
-- 0005 — Private Storage bucket for bug/task attachments.
-- Bucket is private; the app serves files via short-lived signed URLs
-- (open question in CLAUDE.md resolved to: private + signed URLs).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400)  -- 25 MB
on conflict (id) do nothing;

-- Any authenticated user can read (they then get a signed URL from the app).
drop policy if exists "attachments_read" on storage.objects;
create policy "attachments_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments');

-- Staff (not viewers) can upload.
drop policy if exists "attachments_write" on storage.objects;
create policy "attachments_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and public.is_staff());

-- Uploader or admin can delete.
drop policy if exists "attachments_delete" on storage.objects;
create policy "attachments_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and (owner = auth.uid() or public.is_admin()));
