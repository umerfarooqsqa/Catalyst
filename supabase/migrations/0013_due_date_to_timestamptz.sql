-- =====================================================================
-- 0013 — `due_date` gains a time-of-day.
-- The bug/task "Due" field was a bare `date`. The sheet now lets you
-- type a fast relative expression ("3d", "4h", "tomorrow 9am") and an
-- optional clock time, so the column needs to hold a timestamp.
-- Existing dates become midnight UTC. Column name kept for minimal churn.
-- =====================================================================

alter table public.bugs
  alter column due_date type timestamptz using due_date::timestamptz;

alter table public.tasks
  alter column due_date type timestamptz using due_date::timestamptz;
