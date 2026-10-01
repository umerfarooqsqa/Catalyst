-- REQ-2: pre-test version gate source of truth.
-- current_version is the release-notes-stated version a house's app should be on right now;
-- release_notes_ref is a pointer (path/URL/identifier) to the full release notes document.
-- Both are per-project (house) since each white-label app ships releases independently.

alter table public.projects add column current_version text;
alter table public.projects add column release_notes_ref text;

comment on column public.projects.current_version is
  'Expected app version for this house''s current release (REQ-2 version gate). Set by QA when a new release starts.';
comment on column public.projects.release_notes_ref is
  'Path/URL/identifier for this release''s notes document (REQ-1/REQ-2).';
