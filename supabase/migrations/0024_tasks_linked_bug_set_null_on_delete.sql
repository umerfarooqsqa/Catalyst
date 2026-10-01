-- tasks.linked_bug_id had no ON DELETE behavior (defaults to NO ACTION), so
-- deleting a bug linked to a task failed with a raw FK violation instead of
-- succeeding -- affects both the existing bulk-delete and the new per-bug
-- delete button. A task outliving the bug it referenced is fine (same
-- "historical pointer, not a hard dependency" treatment as base_page_id);
-- deleting the bug should never be blocked by a task that mentions it.

alter table public.tasks drop constraint tasks_linked_bug_id_fkey;
alter table public.tasks
  add constraint tasks_linked_bug_id_fkey
  foreign key (linked_bug_id) references public.bugs(id) on delete set null;
