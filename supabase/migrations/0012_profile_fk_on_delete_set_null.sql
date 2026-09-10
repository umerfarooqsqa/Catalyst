-- =====================================================================
-- 0012 — Make user deletion possible.
-- Every attribution/assignment FK to profiles was ON DELETE NO ACTION,
-- so deleting a user who had ever created or been assigned anything
-- failed with a foreign-key violation (this is why /admin/users "delete"
-- did nothing). Switch them all to ON DELETE SET NULL so the history
-- (bugs, requirements, projects, …) survives with an empty author.
-- project_members.user_id and notifications.user_id stay ON DELETE
-- CASCADE — those rows are meaningless without the user.
-- =====================================================================

alter table public.projects
  drop constraint projects_created_by_fkey,
  add constraint projects_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.requirements
  drop constraint requirements_created_by_fkey,
  add constraint requirements_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.test_cases
  drop constraint test_cases_created_by_fkey,
  add constraint test_cases_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.base_page
  drop constraint base_page_created_by_fkey,
  add constraint base_page_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.bugs
  drop constraint bugs_created_by_fkey,
  add constraint bugs_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.bugs
  drop constraint bugs_assignee_id_fkey,
  add constraint bugs_assignee_id_fkey
    foreign key (assignee_id) references public.profiles(id) on delete set null;

alter table public.tasks
  drop constraint tasks_created_by_fkey,
  add constraint tasks_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.tasks
  drop constraint tasks_assignee_id_fkey,
  add constraint tasks_assignee_id_fkey
    foreign key (assignee_id) references public.profiles(id) on delete set null;

alter table public.attachments
  drop constraint attachments_uploaded_by_fkey,
  add constraint attachments_uploaded_by_fkey
    foreign key (uploaded_by) references public.profiles(id) on delete set null;

alter table public.comments
  drop constraint comments_author_id_fkey,
  add constraint comments_author_id_fkey
    foreign key (author_id) references public.profiles(id) on delete set null;

alter table public.requirement_documents
  drop constraint requirement_documents_uploaded_by_fkey,
  add constraint requirement_documents_uploaded_by_fkey
    foreign key (uploaded_by) references public.profiles(id) on delete set null;
