# catalyst database notes: audit logs

(Moved from `catalyst/CLAUDE.md` on 2026-09-29; loads when working under `supabase/`. The rules that must always apply are summarized in `catalyst/CLAUDE.md` under "Audit logs".)

### Task audit log (2026-09-16)

A `task_audit_log` table (`supabase/migrations/0019_task_audit_log.sql`) gives every task a
timestamped history, independent of the comments thread:

- Two `AFTER INSERT`/`AFTER UPDATE` triggers on `tasks` (`tasks_audit_log()`, SECURITY DEFINER)
  write one row per task creation and per changed field (`status`, `assignee_id`, `priority`,
  `due_date`, `title`, `description`) on every update — actor (`auth.uid()`) and `created_at`
  are captured automatically, not passed in from the app.
- The log is **write-once from the app's perspective**: there is no insert/update/delete RLS
  policy granting `authenticated` users access, so rows can only ever be produced by the
  trigger — a direct `insert into task_audit_log` from a normal session is rejected by RLS
  (verified manually; don't add an insert policy for this table without a strong reason).
- `task_audit_log_select` RLS mirrors `tasks_select` from migration 0017 exactly (admin/
  manager/viewer see every row; a contributor only sees the log for tasks where they're the
  assignee or creator) — keep these two policies in sync if task visibility rules change again.
- UI: a new "Audit log" section in `components/TaskDrawer.tsx`, below Comments, rendering
  `TASK_AUDIT_ACTION_LABELS` (`lib/types/models.ts`) against each row's `from_value`/
  `to_value`. Comments were left as their own separate, unmerged section rather than fusing
  everything into one combined activity feed — kept simple since that wasn't asked for.
- Assignee comment + "mark done" were already built (see the section above) and were not
  changed by this work — only the audit trail is new here.

### Portal-wide audit log (2026-09-16)

A second, separate audit system — `audit_log` (`supabase/migrations/0020_portal_audit_log.sql`)
— covers the whole portal, not just tasks. It exists alongside `task_audit_log` above rather
than replacing it; don't try to merge them without a reason:

- **One generic trigger function**, `audit_log_row()` (SECURITY DEFINER), is attached via a
  scripted `do $$ ... $$` block to every data-changing table that has a uuid `id` primary key:
  `bugs`, `tasks`, `requirements`, `test_cases`, `projects`, `comments`, `attachments`,
  `base_page`, `requirement_documents`, `profiles`, `roles`. It inspects `TG_OP`/`NEW`/`OLD`
  generically (via `to_jsonb`), so adding a new table later is one line in that array, not a
  bespoke trigger — but `id` must be a uuid PK for it to work; `project_members` is skipped for
  exactly that reason (composite key, no `id` column).
- **Tasks are intentionally logged in both systems.** `task_audit_log` stays the richer,
  friendly, per-task history that feeds `TaskDrawer`; `audit_log` also captures tasks so the
  portal-wide view has no blind spot. This is accepted duplication, not a bug.
- **Rows outlive the entity they describe.** Unlike `task_audit_log.task_id`, `audit_log`'s
  `entity_id` is a bare uuid with **no FK, no cascade** — deleting a bug/task/requirement/etc.
  does not delete its audit trail, and the delete event itself (with a full jsonb snapshot of
  the row) is preserved. Verified manually: delete a row, its `audit_log` entries survive.
- No-op updates (only `updated_at` changed) are **not** logged — the trigger diffs `NEW` vs
  `OLD` field-by-field first and returns early if nothing else changed, so the log stays signal.
- `changes` is a jsonb snapshot: the full row on insert/delete, a `{field: {from, to}}` diff map
  on update. `summary` is a precomputed short human-readable line for the list view (long
  free-text fields like `description`/`content`/`steps_to_reproduce`/`template_steps` show as
  "`field` changed" in `summary`, not diffed inline — the full values are still in `changes`).
  `entity_label` is a best-effort display name snapshotted from `title`/`name`/`full_name`/
  `file_name`/`label`/truncated `content`, whichever the row has.
- **Admin-only.** `audit_log_admin_select` RLS restricts `select` to `is_admin()` — this is a
  compliance/oversight tool, not a per-project activity feed. No insert/update/delete policy
  exists for `authenticated`, same write-once-via-trigger pattern as `task_audit_log` (verified:
  a forged direct insert as a non-admin is rejected).
- Not covered: Supabase Auth events (login/logout — those live in Supabase's own auth logs, not
  app tables) and `project_members` (see above). Flag to the user before assuming either is
  captured here.
- UI: `/admin/audit-log` (`app/(app)/admin/audit-log/page.tsx`), gated by the existing
  `AdminLayout` (`canAdminister`). Filters by entity/action/project via GET query params (plain
  server-rendered form, no client JS), shows the latest 200 rows, with an expandable `<details>`
  per row for the raw `changes` JSON. Linked from the sidebar's Admin section as "Audit log".
