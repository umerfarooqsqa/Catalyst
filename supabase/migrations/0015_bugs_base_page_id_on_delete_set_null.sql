-- =====================================================================
-- 0015 — Let a bug-library entry be deleted.
-- `bugs.base_page_id` is a purely historical pointer ("this bug was
-- copied from library entry X") — never a live link. It was
-- ON DELETE NO ACTION, so deleting any base_page row that had ever been
-- copied into a project failed with a foreign-key violation. Switch to
-- ON DELETE SET NULL: the library entry goes, the copied bugs stay
-- (they just lose the "originated from" pointer), which is exactly the
-- documented reuse behaviour.
-- =====================================================================

alter table public.bugs
  drop constraint bugs_base_page_id_fkey,
  add constraint bugs_base_page_id_fkey
    foreign key (base_page_id) references public.base_page(id) on delete set null;
