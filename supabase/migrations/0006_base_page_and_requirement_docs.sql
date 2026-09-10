-- =====================================================================
-- 0006 — Unify the reusable library as `base_page`; add the client
-- requirements ingestion pipeline (`requirement_documents`).
--
--   master_bugs                -> base_page
--   bugs.master_bug_id         -> bugs.base_page_id
--   + base_page.source_type    (master_bug | client_requirement)
--   + base_page.project_id     (null for master_bug, set for client_requirement)
--   + base_page.requirement_document_id
--   + requirement_documents    (uploaded PDF/DOCX + parse status)
-- =====================================================================

create type base_page_source as enum ('master_bug', 'client_requirement');
create type requirement_doc_status as enum ('pending', 'processing', 'completed', 'failed');

-- ---------------------------------------------------------------------
-- requirement_documents — one row per uploaded client requirements file
-- ---------------------------------------------------------------------
create table public.requirement_documents (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects(id) on delete cascade,
  file_path              text not null,        -- path inside the 'requirement-documents' bucket
  file_name              text not null,
  file_size_bytes        bigint,
  status                 requirement_doc_status not null default 'pending',
  error_message          text,
  requirements_extracted integer not null default 0,
  uploaded_by            uuid references public.profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index requirement_documents_project_idx on public.requirement_documents(project_id);

create trigger trg_requirement_documents_updated before update on public.requirement_documents
  for each row execute procedure public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Rename master_bugs -> base_page (+ its indexes / constraints / trigger)
-- ---------------------------------------------------------------------
alter table public.master_bugs rename to base_page;

alter index if exists master_bugs_pkey rename to base_page_pkey;
alter index if exists master_bugs_search_idx rename to base_page_search_idx;
alter index if exists master_bugs_title_trgm_idx rename to base_page_title_trgm_idx;

alter table public.base_page rename constraint master_bugs_category_id_fkey to base_page_category_id_fkey;
alter table public.base_page rename constraint master_bugs_created_by_fkey to base_page_created_by_fkey;

drop trigger if exists trg_master_bugs_updated on public.base_page;
create trigger trg_base_page_updated before update on public.base_page
  for each row execute procedure public.touch_updated_at();

-- New columns
alter table public.base_page
  add column source_type base_page_source not null default 'master_bug',
  add column project_id uuid references public.projects(id) on delete cascade,
  add column requirement_document_id uuid references public.requirement_documents(id) on delete cascade;

alter table public.base_page add constraint base_page_source_project_check check (
  (source_type = 'master_bug' and project_id is null) or
  (source_type = 'client_requirement' and project_id is not null)
);

create index base_page_project_idx on public.base_page(project_id);
create index base_page_source_idx on public.base_page(source_type);

-- ---------------------------------------------------------------------
-- Rename bugs.master_bug_id -> bugs.base_page_id
-- ---------------------------------------------------------------------
alter table public.bugs rename column master_bug_id to base_page_id;
alter table public.bugs rename constraint bugs_master_bug_id_fkey to bugs_base_page_id_fkey;

-- ---------------------------------------------------------------------
-- RLS — replace the master_bugs_* policy set with base_page_*
--   select : any authenticated
--   insert : qa / admin
--   update : qa / admin
--   delete : admin
-- ---------------------------------------------------------------------
drop policy if exists "master_bugs_select" on public.base_page;
drop policy if exists "master_bugs_qa_insert" on public.base_page;
drop policy if exists "master_bugs_qa_update" on public.base_page;
drop policy if exists "master_bugs_admin_delete" on public.base_page;

create policy "base_page_select" on public.base_page
  for select to authenticated using (true);
create policy "base_page_qa_insert" on public.base_page
  for insert to authenticated with check (public.is_qa_or_admin());
create policy "base_page_qa_update" on public.base_page
  for update to authenticated using (public.is_qa_or_admin()) with check (public.is_qa_or_admin());
create policy "base_page_admin_delete" on public.base_page
  for delete to authenticated using (public.is_admin());

-- requirement_documents RLS
alter table public.requirement_documents enable row level security;
create policy "requirement_documents_select" on public.requirement_documents
  for select to authenticated using (true);
create policy "requirement_documents_qa_insert" on public.requirement_documents
  for insert to authenticated with check (public.is_qa_or_admin() and uploaded_by = auth.uid());
create policy "requirement_documents_qa_update" on public.requirement_documents
  for update to authenticated using (public.is_qa_or_admin()) with check (public.is_qa_or_admin());
create policy "requirement_documents_admin_delete" on public.requirement_documents
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- Storage: private bucket for requirement documents (one folder / project)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('requirement-documents', 'requirement-documents', false, 26214400)
on conflict (id) do nothing;

drop policy if exists "reqdocs_read" on storage.objects;
create policy "reqdocs_read" on storage.objects
  for select to authenticated using (bucket_id = 'requirement-documents');

drop policy if exists "reqdocs_write" on storage.objects;
create policy "reqdocs_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'requirement-documents' and public.is_qa_or_admin());

drop policy if exists "reqdocs_delete" on storage.objects;
create policy "reqdocs_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'requirement-documents' and (owner = auth.uid() or public.is_admin()));
