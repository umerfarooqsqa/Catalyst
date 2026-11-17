-- =====================================================================
-- 0071: "Java to Flutter", a list of its own in the Bug Library (2026-11-17, asked for by the user)
--
-- The user: "add another component in Bug Library of 'Java to Flutter'; in this component the bugs
-- can be sent from projects to here". Decided:
--   - a fifth tab on /master-library, next to Android / iOS / Generic Bugs / Tradecast;
--   - QA/admin send a project's bug there from the bug drawer ("Send to Java to Flutter"); the entry
--     is a copy (no live link, the same rule as every other library copy), and it remembers which
--     bug and project it came from (informational only, like bugs.base_page_id);
--   - one bug goes there at most once (unique index below);
--   - an entry keeps its source project's platform, so the visibility rules of 0034/0064/0070 and
--     the "Copy to project…" platform rule apply to it unchanged;
--   - the Android / iOS / Generic Bugs / Tradecast lists don't show these entries (collection IS NULL).
-- RLS: unchanged. base_page_qa_insert / _qa_update (0006) already let only QA/admin write.
-- =====================================================================

alter table public.base_page
  add column if not exists collection text
    constraint base_page_collection_check check (collection in ('java_to_flutter')),
  add column if not exists source_bug_id uuid
    references public.bugs (id) on delete set null,
  add column if not exists source_project_id uuid
    references public.projects (id) on delete set null;

create index if not exists base_page_collection_idx
  on public.base_page (collection)
  where source_type = 'master_bug';

-- the same project bug is sent to a list only once
create unique index if not exists base_page_collection_source_bug_uniq
  on public.base_page (collection, source_bug_id)
  where source_bug_id is not null;
