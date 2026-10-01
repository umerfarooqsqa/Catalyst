# CLAUDE.md — Catalyst IT Solutions

This file is project memory for Claude (via Claude Code or claude.ai) when working on this
codebase. Read this in full before making changes. Keep it updated as decisions change —
treat it as the source of truth for *why* things are built the way they are, not just *what*
exists in the code.

## What this is

An internal task-management and bug-tracking web app for Catalyst IT Solutions. Built for a
team of 10–50 people testing and developing multiple apps. Combines requirement traceability,
QA bug tracking, and developer task management in one system, with a reusable "master bug
library" so testers don't retype bugs they've already documented on other apps.

Not a generic project-management clone — the two things that make this system specific to how
this team works are:
1. **The master bug library.** A shared, cross-project, searchable table of bugs. When a
   tester finds a bug similar to one seen before, they pull it from the library and it copies
   in as a new, independent, editable row (no live link back to the master entry — see
   "Master library reuse behavior" below).
2. **Requirement → Test Case → Bug traceability.** QA writes requirements, writes test cases
   against them, and bugs can link back to the requirement they violate.

## Tech stack

Why this stack: one codebase for frontend+backend, Postgres for the relational
requirement→test case→bug traceability, and Supabase gives auth/storage/RLS/realtime out of
the box instead of hand-building each. Firebase/Firestore was considered and rejected — the
data model here is relational, not document-shaped.

## Supabase project

- Project ref: `axlvyftdvwpxmlnglsvs` (region `ap-south-1`) — this is the project actually
  holding all app data. **Note:** an earlier project (`jdzgctelcsrqocwmpngu`) was created first
  during initial scaffolding on 2026-09-09 and is referenced by its old name in some git
  history, but real development shifted to `axlvyftdvwpxmlnglsvs` within the same day and that
  old project is now paused/inactive. If `.env.local` or this file ever drift back to the old
  ref, every Supabase call will fail outright (looks like a generic "Failed to fetch" in the
  browser) because the old project is suspended — always verify the ref against
  `NEXT_PUBLIC_SUPABASE_URL` before debugging further.
- Project URL: `https://axlvyftdvwpxmlnglsvs.supabase.co`
- Anon/publishable key (safe to expose client-side — RLS gates all actual data access):
  ```
  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4bHZ5ZnRkdndweG1sbmdsc3ZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5MzgwNzgsImV4cCI6MjEwNDUxNDA3OH0.BHQrPyT8MauUc4lXIGiPC9EW-EYV4TuUOILKYRe2VzM
  ```
- Publishable key (newer format, same purpose): `sb_publishable_IRbQfpZI6zRpySWEO0Rz0A_SlyHFWEF`
- These belong in `.env.local` (gitignored — don't commit the file itself, even though the
  values above are safe to read) as:
  ```
  NEXT_PUBLIC_SUPABASE_URL=https://axlvyftdvwpxmlnglsvs.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4bHZ5ZnRkdndweG1sbmdsc3ZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5MzgwNzgsImV4cCI6MjEwNDUxNDA3OH0.BHQrPyT8MauUc4lXIGiPC9EW-EYV4TuUOILKYRe2VzM
  ```
- **service_role key is now configured and in use.** It lives only in `.env.local` under
  `SUPABASE_SERVICE_ROLE_KEY` (no `NEXT_PUBLIC_` prefix, so it's never bundled client-side) —
  never write the value into this file or any committed file. It's consumed exclusively via
  `getAdminClient()` in `lib/supabase/admin.ts`, which re-checks the caller is an admin before
  returning the privileged client, and is used by the admin-only user-management server
  actions in `app/(app)/admin/actions.ts` (`createUser`, `setUserPassword`, `deleteUser`) to
  call the GoTrue admin API and bypass RLS. If this env var is ever missing, those three
  actions throw immediately and the failure surfaces as a generic uncaught Server Component
  error — check `.env.local` first before debugging further.
- Schema was created via a single SQL script run in the Supabase SQL Editor (see
  `/supabase/schema.sql` in this repo for the canonical copy — keep it in sync with the live
  DB; any future schema change should be added as a new migration file, not by editing that
  file in place, once migrations are set up).

## Roles & permissions model

| Role | Summary |
|---|---|
| `admin` | Full control: manage users, projects, requirements, SLA settings, all sheets |
| `qa` | Create requirements/test cases, log bugs, reuse from master library, assign tasks |
| `dev_app` | App-specialty developer — sees/updates bugs & tasks assigned to them |
| `dev_web` | Web-specialty developer — same as above, different specialty tag |
| `viewer` | Read-only (e.g. stakeholder/client) |

Role lives on `profiles.role`. `specialty` (`app` / `web`) is only meaningful for dev roles and
is used to route bug/task assignment to the right kind of developer. `project_members` allows
a per-project role override if someone needs different permissions on a specific project.

**RLS status:** enabled on every table, but only baseline policies exist so far (profiles are
readable by any authenticated user; users can edit their own profile). Full role-based
policies per table (who can insert/update/delete bugs, tasks, requirements, etc. based on
`profiles.role` and `project_members`) are a known TODO — do not assume they exist yet, and
flag this to the user before treating any environment as production-ready.

**⚠ Note (2026-09-12): the table above and the two paragraphs after it are stale.** The fixed
`qa`/`dev_app`/`dev_web`/`viewer` role enum and `specialty` column described here were replaced
by migration `0011_roles_table.sql` with a configurable `roles` table (admins can add roles
like "Android"/"iOS"/"Backoffice") carrying a permission **level**: `admin` / `manager` /
`contributor` / `viewer` (`lib/permissions.ts`, `lib/types/models.ts` `RoleLevel`). Full
role-based RLS now exists per table (see `supabase/migrations/0002_helpers_and_rls.sql` and
`0011_roles_table.sql`) — the "known TODO" above is also stale. This note is left in place
rather than rewriting the section above so the history stays visible; treat `lib/permissions.ts`
+ the migrations as the source of truth over the stale text above until someone does that
rewrite.

### Platform visibility, developer rights on bugs, comments (2026-09-29, migration 0034; applied 2026-09-29 via the Management API and deployed as `00db2094-2ea6-4832-a887-f4fcfa5c5108`)
- **Platform per role:** `roles.platform` is `android`, `ios` or null. The seeded `android`/`ios` roles have it set, and admins choose it on Admin → Roles ("Sees projects").
- **What a platform-bound user sees:** only that platform's projects and everything in them (bugs, releases, tasks, requirements, test cases, attachments and their files, comments, automation runs/jobs/folders), plus that platform's Bug Library entries. Projects with no platform are hidden from them. Roles with no platform (admin, QA, backoffice, viewer) are unchanged.
- **Enforcement:** RLS, via `user_platform()`, `can_see_project()`, `can_see_bug()` and `can_see_task()`, all SECURITY DEFINER. Pages need no change: the project layout already 404s a project RLS hides.
- **Developers (contributor level) on bugs:** they can view, comment, attach files, and move a bug they can see to **In progress** or **Fixed** (open/reopened → in progress/fixed, in progress → fixed). "Mark fixed" takes an optional note for QA, posted as a comment.
  - They cannot edit fields, close, reopen, set ready for retest, assign, change the version, delete or bulk-edit, and they can't touch a closed bug.
  - The UI hides these controls instead of disabling them. Text shows read-only, the status picker lists only the allowed statuses, the bulk toolbar and the `a`/`d` shortcuts are manager-only, and RetestList's Close is manager-only.
  - The rule is enforced by `bugs_update` (staff on visible projects) plus the `trg_bugs_developer_rights` BEFORE UPDATE trigger (only `status` may change, to in_progress/fixed). Service-role calls (automation API) and QA/admin are exempt.
  - `canEditBug` is now manager-only; `developerStatusTargets()` is in `lib/permissions.ts`.
  - Bug Library: "Copy to project…" is shown only to QA/admin (`canCreateBugs`); adding library bugs to projects isn't a developer's job. `bugs_qa_insert` RLS already refused it.
- **Comments** (`components/BugComments.tsx`):
  - Live updates (comments are added to the `supabase_realtime` publication).
  - Authors edit or delete their own; admins delete any. `comments.edited_at` is set by the `trg_comments_on_edit` trigger, which also allows only the text to change, and the comment shows "edited".
  - Author role badge, and Ctrl+Enter to post. The insert policy also requires that the commenter can see the bug.
- **Not covered:** the requirement-documents storage bucket read policy is not platform-filtered, and task comments/drawer still use the old UI.

### Project developer + My Queue actions (2026-09-29, migration 0035; applied and deployed as `80ca7b9a-418c-41e9-9cba-8ed653c51efa`, rollback `npx wrangler rollback 00db2094-2ea6-4832-a887-f4fcfa5c5108`)
- **"Project developer"** bar on the Bugs page (QA/admin pick one; others see the name). It calls `assign_project_developer(project, developer)`, a SECURITY INVOKER function that is QA/admin only. It:
  - sets `projects.assigned_developer_id`;
  - assigns every open, **unassigned** bug to that developer (bugs already assigned keep their assignee);
  - makes `trg_bugs_default_assignee` give every new unassigned bug in the project to them, from the UI, the library or automation.
- **Platform check:** `trg_projects_check_developer` refuses a developer whose role platform differs from the project's. Assignee pickers now offer only people who can see the project (role platform none or equal), and the developer list shows contributor-level roles.
- **My Queue:**
  - Bugs have **Start** / **Mark fixed** (the developer transitions from 0034); fixed bugs show "waiting for QA".
  - Tasks have **Start** / **Mark done → approval**, which sets `pending_approval`. An admin's "Mark done" goes straight to done, since done still needs admin approval (0017).
  - Components: `components/QueueActions.tsx`.
- **Tested** in a rolled-back transaction as a real admin and developers: 4 open bugs assigned, a new bug auto-assigned, an Android developer on an iOS project refused, a developer calling the function refused.

### Automation hidden from developers (2026-09-29, migration 0036; deployed `1827c7ff-990d-4d18-94df-74b900c43003`, rollback `npx wrangler rollback 80ca7b9a-418c-41e9-9cba-8ed653c51efa`)
- **Hidden for contributor-level roles (developers):** the sidebar's Automation link, each project's Automation tab (runner folder, stats, jobs) and both pages. The pages redirect: `/automation` goes to the dashboard, a project's automation page to the project. This uses `canSeeAutomation` in `lib/permissions.ts`.
- **In the database:** `project_automation`, `automation_runners` and `test_jobs` select policies exclude `is_contributor()`. Verified: an Android developer reads 0 folders, 0 runners and 0 jobs; an admin reads 16, 1 and 13.
- **Unchanged:** automation writes use the service role. The bug drawer's Automation box was already manager-only.

### App versions written by QA + confirming a version's bugs (2026-09-30, migration 0037; applied 2026-10-01, deployed `438d9f04-b4f4-4866-af61-f9f4b8f4c5f0`)
- **App versions panel** (`components/VersionsPanel.tsx`, top of the Bugs page):
  - **Everyone** (developers included) sees each version (release), which one is current, and its bug count with how many are confirmed. Clicking a version filters the board.
  - **QA/admin** add a version with "+ Add version" (`addAppVersion` in `app/(app)/projects/actions.ts`, RLS `releases_qa_insert`), optionally making it the project's current version. That is the default for new bugs. Automation still waits for that version's release notes.
- **Confirming:** "Review & confirm" lists the version's unconfirmed bugs, ticked. QA unticks any that belong elsewhere and confirms the rest. The drawer has "Confirm vX" / "undo" per bug.
  - **Columns:** `bugs.version_confirmed_at` / `version_confirmed_by`.
  - **Trigger `trg_bugs_version_confirmation`** stamps the time and `auth.uid()` (never the client's values), clears the confirmation whenever `release_id` changes (including automation re-pointing), and refuses to confirm a bug with no version.
  - **Developers** can't change either column (0034's developer-rights trigger).
- **Shown everywhere:** `components/VersionChip.tsx` ("v1.0.7 ✓" = confirmed, grey = not confirmed yet, amber "no version") appears on the Bugs sheet and cards, My Queue, the Retest list and the drawer ("✓ confirmed by X, date" / "not confirmed by QA yet"). The Excel export has a "Version Confirmed" column.
- **Deploy order:** apply 0037 **before** deploying. The Bugs and Retest pages join `profiles!bugs_version_confirmed_by_fkey`, which fails until the column exists.

### "Marked fixed" alerts the tester and every admin (2026-09-30, migration 0038; applied 2026-10-01)
- **What changed:** `public.bugs_notify()` (0003) is replaced. A move to `fixed`, by anyone, sends one `retest_ready` notification to the bug's tester (`created_by`), every user whose role level is `admin`, and the assignee if someone else marked it. The person who marked it is never notified. The message says who marked it fixed and in which version: 'Bug "X" was marked fixed by Ali in v1.0.7. Please retest it.'
- **No duplicates:** it replaces the generic "moved to fixed" ping. Other status changes, assignment and ready-for-retest pings are unchanged.
- **Automation bugs** have no `created_by`, so only the admins (and the assignee) hear about them.
- **Opening the bug from a notification (2026-09-30):**
  - **Link:** every bug notification (bell and Notifications page) links to `/bugs/<id>` (`app/(app)/bugs/[bugId]/page.tsx`). That route looks the bug up under the viewer's session (RLS) and redirects to `/projects/<project>/bugs?focus=<id>`, where the drawer opens; a bug the viewer can't see is a 404. Before, links went to `/my-queue?bug=`, which ignores the parameter and lists only the viewer's own bugs, so an admin never reached the bug.
  - **Bugs page:** `BugBoard` also opens the drawer when `?focus=` changes on an already open page. Closing the drawer removes the parameter, so a later link to the same bug opens it again. Clicking a notification marks it read.
  - **Tasks, the same way:** task notifications link to `/tasks/<id>` (`app/(app)/tasks/[taskId]/page.tsx`), which redirects to `/projects/<project>/tasks?focus=<id>`; `TaskBoard` opens that task's drawer, where an admin approves or sends it back. RLS applies: a developer only reaches tasks they may see (0017). Web Push already used `?focus=` for tasks, which the Tasks page ignored until now.
- **Instant in the app:** the bell is live over realtime (0016) for anyone with the portal open.
- **Push to closed apps is not live:** it needs the 0016 webhook configured. That means `private.settings` rows `push_dispatch_url` / `push_dispatch_secret`, and the same value as the worker secret `PUSH_DISPATCH_SECRET`. On 2026-09-30 the worker had no `PUSH_DISPATCH_SECRET` (`wrangler secret list`: only `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY`), so `/api/push/dispatch` answers 401.

### Lead and junior developers (2026-10-01, migration 0040; applied 2026-10-01 via the Management API, deployed `438d9f04-b4f4-4866-af61-f9f4b8f4c5f0`, rollback `npx wrangler rollback 99d3b7ea-a59d-43c7-85a4-9250b43dcfc5`)
- **Rank:** `profiles.dev_rank` is `lead`, `junior` or null (a regular developer). An admin sets it on Admin → Users, next to the role. It is saved only for contributor-level (developer) roles, and cleared otherwise (`updateUser`).
- **Handing on:** a lead developer can hand a bug or task **assigned to them** to a junior developer who can see the project (same platform rule as `can_see_project`). They can then move it to another junior or take it back. Any junior on the platform qualifies; there are no fixed teams.
  - **Where:** My Queue (`DelegateSelect` in `components/QueueActions.tsx`): "Hand to junior…" on the lead's own cards, plus a "Handed to junior developers" section with "Reassign…" / "↩ Take it back". The junior's cards show "from <lead>".
  - **Tracking:** `bugs.delegated_by` / `tasks.delegated_by` hold the lead. Only the triggers set them. A QA/admin or automation reassignment clears them, since the item is no longer the lead's to hand on.
  - **Rights:** the junior works the item with the usual developer rights (0034 bugs, 0017 tasks). On a handed-on task the lead may only reassign or take it back. The lead keeps seeing it: `tasks_select`, `tasks_update` and `task_audit_log_select` all gained `delegated_by = auth.uid()`.
  - **Enforcement:** `delegation_target()`, called from `bugs_enforce_developer_rights` (0034, extended) and the new `trg_tasks_enforce_delegation`. A non-lead developer still can't reassign anything.
- **Role changes are admin-only now:** `profiles_update_self` (0002) let any user update their own row, `role` included, so anyone could make themselves an admin through the API. `trg_profiles_protect_admin_fields` refuses `role`/`dev_rank` changes unless the caller is an admin (or the service role).
- **Not covered:** the lead isn't notified when the junior marks the item fixed or done; the bug/task drawers don't show "handed on by".
- **Tested** before applying, in one rolled-back transaction with 0037–0040 and synthetic users: 32 checks, 0 failures. Covered: hand on / move to junior 2 / take back (bugs and tasks), refusals (iOS junior, unranked developer, someone else's bug, editing a handed-on item, a junior reassigning or clearing `delegated_by`), the lead still seeing the task and its history, QA reassignment clearing `delegated_by`, and self-promotion to admin or lead refused.
- **Deploy order:** apply 0040 **before** deploying. My Queue joins `profiles!bugs_delegated_by_fkey`, which fails until the column exists.

### Frontend / backend bugs (2026-10-01, migration 0041; applied 2026-10-01 after a 23-check rolled-back test, deployed `81f2f167-b1fc-4b53-8f6b-827582b4079b`, rollback `npx wrangler rollback 438d9f04-b4f4-4866-af61-f9f4b8f4c5f0`)
- **What it means (decided with the user):** frontend = the app UI (screens, layout, navigation); backend = the trading server/API (wrong data, failed orders, feed, login service). `bugs.area` and `base_page.area` are `frontend`, `backend` or null ("not set").
- **Suggested, never forced:** `lib/bug-area.ts::suggestArea` scores whole-word hints (built-in, plus each category's `keyword_hints` toward its `bug_categories.default_area`, plus 2 for the chosen category's area); a tie gives no suggestion. Admin → Categories sets each category's "Usually".
- **Who sets it:** QA/admin. It is required in "Log a bug" (pre-filled by the suggestion). Developers can't change it: 0040's developer-rights trigger already refuses every column but status.
- **Where it shows:**
  - Bugs page: Area column (editable, sortable), "Area" filter (incl. "Not set"), card badge, bulk "Set area…", export column, and "Classify N bugs" (`components/ClassifyAreaDialog.tsx`: every open not-set bug with its suggestion pre-picked).
  - Drawer: area select with the suggestion and "Use it"; "Copy to iOS/Android" copies it.
  - Bug Library: filter, per-entry select, new-entry field, import column (`area`/`layer` headers, else suggested), export; copying to a project or platform carries it.
  - My Queue, Retest and the project overview ("Open bugs by area"). `components/AreaChip.tsx` is the badge.
- **A developer per area:** `projects.frontend_developer_id` / `backend_developer_id`; `assigned_developer_id` (0035) is now the developer for bugs with no area and the fallback. The Bugs page bar has three pickers. `assign_project_developer(project, developer, area)` sets one and assigns that area's open, unassigned bugs; `trg_bugs_default_assignee` routes a new bug by its area.
  - **Moving with the area:** `areaPatch()` moves an open bug to the new area's developer only when it is unassigned or still with the developer its old area routed it to. A bug assigned by hand, or handed to a junior, keeps its assignee. The drawer and bulk/classify have a checkbox for it; the sheet cell always applies it.
  - The new columns started as a copy of `assigned_developer_id`, so routing was unchanged until QA picked someone.
- **Automation:** the aktrade runner sends `area` per failure (conftest `_test_area`: API-only test = backend, else frontend) and in "Export to catalyst". Without it, `areaFromTestKey` derives it from the test path (`akdapiautomation/` = backend, `tests/` = frontend). An existing bug's area is never overwritten by automation. The auto-test "File as bug" form has an area select.
- **Deploy order:** apply 0041 **before** deploying (the pages read the new columns).
- **Four areas + skills (2026-10-01, migration 0042; tested in a rolled-back transaction, 15 checks; applied and deployed `87a0ab75-b44c-4f08-977b-78f94dfaf14e`, rollback `npx wrangler rollback 81f2f167-b1fc-4b53-8f6b-827582b4079b`):**
  - **Areas:** also `database` (DBA: queries, missing/duplicate records, deadlocks) and `devops` (servers, deployments, downtime, SSL, gateways), on bugs, the library and category defaults. The suggestion has hints for both; a phrase hint counts 2, a word 1.
  - **A developer per area:** `projects.database_developer_id` / `devops_developer_id`, same platform check, routing and `assign_project_developer` support. They start empty, so those bugs go to the no-area developer until QA picks someone. The Bugs page bar has five pickers.
  - **Skills:** `profiles.skills text[]`, any combination of the four (decided with the user: one person can have several). Admin → Users has a tick box per skill; only an admin can change them (`trg_profiles_protect_admin_fields`).
  - **What skills do:** an area's developer picker lists the developers with that skill (`peopleForArea`; everyone while nobody has it yet). A bug's assignee lists show people with the bug's area skill first (`components/AssigneeOptions.tsx`).
- **Role categories (2026-10-01, migration 0043; tested in a rolled-back transaction, 34 checks; applied and deployed `fa009755-21b5-4906-8f3b-61d8aeca513b`. Don't roll back to an earlier build: they read the project columns 0043 dropped):** the fixed four areas became an admin-managed list, and tasks use it too (decided with the user).
  - **Admin → Role categories** (`app/(app)/admin/role-categories/page.tsx`, actions in `app/(app)/admin/actions.ts`):
    - add, rename, recolour, reorder or delete a category; each has keywords for the suggestion;
    - add or remove people (their `profiles.skills`), and see each person's open work and who is "next up".
    - **Keys never change.** Deleting a category clears it from bugs, tasks, library entries, bug-category defaults and people, and drops its project people.
  - **`role_categories`** (key, label, short_label, description, keywords, color, sort_order) replaces the hard-coded lists and check constraints. `bugs.area`, `tasks.area`, `base_page.area` and `bug_categories.default_area` reference its key. `profiles.skills` is checked by `trg_profiles_validate_skills`. Readable by anyone (anon too, like bug categories); admin-only writes; audited.
  - **`project_area_developers`** (project, area, developer) replaces `projects.frontend/backend/database/devops_developer_id`, which were copied over and dropped. `assign_project_developer(project, developer, area)` writes it.
  - **Auto-assignment:**
    - **Tasks:** a task with a category and no assignee goes to the least busy person in it who can see the project (`least_busy_in_category`: fewest open tasks + open bugs, ties by name, assignable roles only). The assignee is notified (`trg_tasks_notify_insert`; `tasks_notify` only fires on update).
    - **Bugs:** a bug with a category goes to the project's person for it, else the least busy person in it, else `assigned_developer_id`.
  - **Categories that span Android and iOS (`role_categories.all_platforms`; decided with the user: backend and DBA work isn't platform-specific).** Seeded on for backend and database; a tick box on the admin page.
    - **Assignment:** people in such a category can be a project's person for it and be auto-assigned its work on any platform's project. `least_busy_in_category` and `project_area_developers_check` skip the platform rule for it.
    - **Visibility:** `user_platform()` (0034, replaced) is NULL for them, so they see every platform's projects and everything in them.
    - **Unchanged:** a platform-specific category (frontend) still follows the role's own platform (`profile_platform()`, unchanged). The Bugs page pickers offer cross-platform people only for cross-platform categories.
    - **Tested:** 8 more checks (34 total), including an iOS-role backend person getting, and seeing, an Android backend task while being refused as its frontend person.
  - **App:** `getRoleCategories()` (`lib/data.ts`, cached, tag `role-categories`) is loaded once by the app layout into `RoleCategoriesProvider` (`components/RoleCategories.tsx`). Components read it with `useRoleCategories()`. `lib/bug-area.ts` is now data-driven (`suggestArea(text, roleCats, bugCats, bugCategoryId)`, `categoryOf`, `isArea`, `shortLabel`, colours by name). Automation routes validate an `area` against the table.
  - **Tasks page:** Category column, filter, badge and export. "New task" suggests the category and offers "Auto: least busy in …" as the assignee.
  - **Deploy order:** apply 0043 and deploy **together**. 0043 drops the four project columns that the previous build's Bugs page reads, and the new build reads `project_area_developers`.
- **Admin verify queue (2026-10-01, deployed `87a0ab75`):** My Queue shows admins "Fixed: waiting for you to verify": every fixed / ready-for-retest bug across projects, oldest first, with who marked it fixed and when (from `audit_log`), and Close / Reopen (`VerifyFixActions` in `components/QueueActions.tsx`). No migration.

### Task visibility + done-needs-approval (2026-09-12)

Two deliberate departures from the "everyone sees every sheet" default, added on request:

- **Per-assignee task privacy.** A `contributor`-level user (the role level tasks actually get
  assigned to) now only sees tasks where they're the `assignee_id` or the `created_by`.
  `admin`, `manager`, and `viewer` levels are unaffected — they still see every task in a
  project, since managers need the full backlog to plan/assign and admins need it to approve.
  Enforced in `tasks_select` RLS (`supabase/migrations/0017_task_visibility_and_approval.sql`),
  not just in the UI — do not assume a wider "everyone sees everything" default for tasks
  anywhere else in the app without checking that migration first.
- **`done` requires admin approval.** New `task_status` value `pending_approval`, sitting
  between `blocked` and `done`. Anyone with edit rights on a task (assignee/creator/manager/
  admin) can move it to `pending_approval` ("mark done → send for approval"), but a DB trigger
  (`tasks_enforce_approval`) blocks anyone but an `admin` from setting `status = 'done'`
  directly — that update fails with a Postgres exception surfaced as a normal Supabase error,
  not a crash. An admin reviews a `pending_approval` task and either approves it (→ `done`) or
  sends it back (→ any other status). Notifications (reusing the existing `status_change` type
  rather than growing the enum) ping every admin on submission and the assignee on approval/
  send-back. UI: `components/TaskDrawer.tsx` (comments + the approve/send-back buttons),
  wired into `components/TaskBoard.tsx` via a small "↗" affordance next to each task's title
  (sheet view) or by tapping the card (cards view) — the existing inline spreadsheet editing
  is untouched.
- Task comments were already permitted at the DB level for `contributor`s
  (`comments_staff_insert` RLS uses `is_staff()`, which includes `contributor`) — what was
  actually missing was UI, since `TaskBoard` had no per-task detail view before this. Bugs
  already have this whole pattern (`fixed` → `ready_for_retest`, `components/BugDrawer.tsx`);
  the task version deliberately mirrors it rather than inventing a different shape.

### Audit logs (`task_audit_log`, `audit_log`)
Details: `supabase/CLAUDE.md`, which loads when working on migrations. **Both are written only by triggers: never add insert/update/delete policies for `authenticated` on them**, and keep `task_audit_log_select` mirroring `tasks_select` (0017) whenever task visibility changes. `audit_log` is admin-only, and its rows deliberately outlive what they describe (no FK).

## Data model reference

Core tables (see `/supabase/schema.sql` for full DDL, types, and constraints):

- `profiles` — extends `auth.users`, holds role and `dev_rank` (lead/junior developer, 0040)
- `projects`, `project_members` — one project per app being tested
- `role_categories`, `project_area_developers` — the work areas bugs and tasks are filed under and auto-assigned by, and each project's person per area (migration 0043)
- `requirements` → `test_cases` — traceability chain, scoped to a project
- `bug_categories` — templates: default severity, template steps, keyword hints for
  auto-severity suggestion
- `base_page` — **the unified reference library** (as of migration 002; this table used to be
  called `master_bugs`). Holds two kinds of rows, distinguished by `source_type`:
  - `master_bug` — global, reusable across all projects (`project_id` is `null`)
  - `client_requirement` — scoped to one project (`project_id` required), extracted from an
    uploaded requirements document, stored in the **same bug-shaped columns** (title,
    description, steps_to_reproduce, severity, category, tags) so requirements and reusable
    bugs live side by side in one searchable table
  Full-text + trigram indexed for live search/suggest.
- `requirement_documents` — one row per uploaded client requirements file (PDF/DOCX) per
  project. Tracks `status` (pending/processing/completed/failed) through the parse pipeline
  and how many `base_page` rows it produced.
- `bugs` — per-project sheet, **same column set as `base_page` plus** project-specific
  fields (`assignee_id`, `due_date`, `sla_deadline`, `requirement_id`, `base_page_id` for
  history only — renamed from `master_bug_id` in migration 002)
- `tasks` — open backlog (no sprints), optional link to a bug. `status` includes
  `pending_approval` (contributor-submitted, awaiting admin sign-off) between `blocked` and
  `done` — see "Task visibility + done-needs-approval" below.
- `task_audit_log` — timestamped history of every task create/status/assignee/priority/
  due_date/title/description change, written only by a DB trigger (never insertable from the
  app) — see `supabase/CLAUDE.md`.
- `audit_log` — portal-wide, admin-only activity trail across bugs/tasks/requirements/
  test_cases/projects/comments/attachments/base_page/requirement_documents/profiles/roles.
  Also written only by a DB trigger; rows are **not** cascade-deleted with the entity they
  describe — see `supabase/CLAUDE.md`.
- `attachments`, `comments` — polymorphic-ish (linked to either a bug or a task, enforced by
  a check constraint, never both)
- `notifications` — assignment / status_change / comment / sla_breach / retest_ready
- `sla_settings` — global default thresholds (project_id NULL) + per-project overrides,
  editable by Admins only

### Master library reuse behavior (important, don't change without asking)

Pulling an entry from `base_page` into a project's `bugs` table **copies the row** — it does
**not** create a live/synced link. `bugs.base_page_id` is kept only as a historical pointer
("this bug originated from library entry X"), purely informational. Editing a bug in a project
must never write back to the library entry, and editing a library entry must never cascade to
already-copied bugs. This applies whether the source entry is a `master_bug` or a
`client_requirement` row. This was an explicit product decision, not an oversight.

### Same headings, everywhere

`bugs` and `base_page` share the same core columns (title, description,
steps_to_reproduce, severity, category_id, tags where applicable) by design, so that:
- copying a library entry into a project sheet is a straightforward field-for-field copy
- Excel exports look consistent whether exporting the library or a project's bug sheet
Keep these columns in sync across both tables if the schema changes.

### Requirements ingestion pipeline

**Replaced 2026-09-29: requirement documents are no longer uploaded in catalyst.**
- **Where they're added now:** the aktrade Development Portal, next to the release notes. A local Claude Code session extracts the requirements, a person reviews them, and `POST /api/automation/requirements` (shared secret) stores the file in the `requirement-documents` bucket, a completed `requirement_documents` row and the `base_page` client_requirement rows. `GET` on the same route returns the categories and the documents.
- **What was removed:** the Gemini route (`app/api/requirement-documents/[id]/process`), `lib/gemini.ts`, `GEMINI_API_KEY` from `lib/env.ts`, and the panel's upload/run buttons. `RequirementDocsPanel` still lists the documents and extracted requirements, with copy-to-bug and delete.
- **Upload is back, for Claude Code (2026-09-30):** "Send to Claude Code" on the Requirements page (managers, projects with an app).
  - **Upload:** it stores the file in the bucket and inserts a `pending` row with the user's own session, under the existing RLS.
  - **Claim:** the runner takes it through `POST /api/automation/requirements/claim` (→ `processing`, labelled "With Claude Code"). Claude extracts it there and a person reviews it on the Development Portal. The save (`POST /api/automation/requirements` with `document_id`) completes the same row.
  - **Failures:** a failed or discarded extraction comes back as `failed` with the reason, and "send again" resets it to `pending`.
  - **No migration:** the `requirement_doc_status` enum already had these states.
  - **Colour chips:** extracted descriptions show a chip beside each hex code (`ColorText`). The extraction prompt (aktrade `utils/requirements_doc.py`) gives sizes as a share of the screen and colours as name, look and hex.
- `GEMINI_API_KEY` can be removed from `.env.local` and the worker. It is still baked into the currently deployed bundle.

## Key behaviors to implement (v1 scope)

- **Persistent login** — Supabase auth session should persist (refresh token), not require
  re-login every visit.
- **Live duplicate-bug suggestion** — as a user types a new bug title, query `master_bugs`
  (trigram-indexed) and show likely matches inline.
- **Master library search page** — full search (title/description/tags/severity), not just
  the live-suggest-while-typing flow.
- **Bug category templates** — selecting a category pre-fills `steps_to_reproduce` structure
  and `default_severity`.
- **Auto-severity suggestion** — keyword-match against `bug_categories.keyword_hints`
  (e.g. "crash", "data loss", "security" → suggest Critical). Always overridable by the user,
  never silently forced.
- **Keyboard shortcuts** — `n` new bug, `a` assign, `d` mark done, in the table views.
- **Table-first UI** — bugs/tasks are primarily a fast, spreadsheet-like editable table, not a
  Kanban board. Inline cell editing, sortable/filterable columns, saved views, bulk actions.
- **"My Queue" view** — a developer's assigned bugs/tasks only, sorted by due date/SLA
  urgency.
- **"Mark fixed → ready for retest"** — a one-click status transition on a bug that
  auto-notifies the original QA tester (the bug's `created_by`) to verify.
- **SLA aging alerts** — compare `bugs.sla_deadline` (computed at creation/assignment from
  `sla_settings`, resolving project override → global default) against `now()`; flag and
  notify when breached.
- **Notifications** — in-app, triggered on assignment, status change, new comment, SLA
  breach, and retest-ready.
- **Attachments** — file/screenshot upload on bugs and tasks via Supabase Storage.
  - **📱 Take phone screenshot** (bug drawer, staff only; 2026-09-28): the browser calls the aktrade Control Center on the tester's own PC (`NEXT_PUBLIC_PHONE_HELPER_URL`, default `http://localhost:217`).
  - That runs `adb exec-out screencap -p` (aktrade `utils/phone_screenshot.py`). The browser then uploads the PNG as a normal attachment of that bug, with the same bucket, `attachments` row and RLS.
  - When several phones are connected, the drawer asks which one to capture.
  - The helper answers only requests from its own machine carrying an allowed portal `Origin` (the origin of aktrade's `CATALYST_API_BASE_URL`, plus `PHONE_SCREENSHOT_ORIGINS`).
  - The helper origin must be in the CSP `connect-src` (`next.config.ts`).
  - Chrome may ask once to allow the site to access devices on the local network.
  - It only works on a PC that runs the aktrade dashboard; there is no WebUSB fallback (decided 2026-09-28).
  - **📍 Where it happens (2026-09-28, `lib/bug-context.ts`):** NewBugDialog (checkbox, on by default when the project has a house) and the bug drawer ("📍 Capture where it happens") call `POST localhost:217/adb/bug-context`.
    - **Captured:** the app screen + path from the test phone.
    - **Attached:** a screenshot + `where-it-happens-*.md`, and an empty "Steps to reproduce" is filled with the path.
    - **Learned:** the Control Center saves it and adds it to the app's automation knowledge (aktrade `utils/bug_context.py`).
    - **If it fails:** saving the bug never waits on it; a failure is reported after saving.
- **Excel export** (`lib/export.ts`, 2026-09-28): every "Export .xlsx" button (Bugs, Tasks, Bug Library) now writes a formatted sheet with ExcelJS, loaded only on export. It has a styled, frozen, filterable header, sized and wrapped columns, borders and banded rows. SheetJS (`xlsx`) is still used for importing.
  - The **Bugs** export also embeds each bug's image attachments (`loadBugScreenshots`), including phone screenshots.
  - On the Bugs sheet, a "Screenshots" column links to the images and a "Preview" column shows the first one.
  - A **Screenshots** sheet has one row per image: bug, file, upload time, and the picture itself (up to 360×530 px).
  - Images are downscaled and re-encoded as JPEG in the browser. At most 300 are included, and the user is told how many were left out.
- **Excel export** — any table view exports to `.xlsx`, respecting whatever filters are
  currently active.
- **Requirement → Test Case → Bug traceability view** — a way to see, per requirement, which
  test cases exist and which bugs were filed against it.

## Explicitly out of scope for v1

- Sprints / time-boxed cycles — this is an **open backlog with due dates only**.
- Live-synced master bug links — see "Master library reuse behavior" above.
- Git/PR/commit linking on bugs — considered, deferred to a later version.
- Master library staleness/archival flagging — considered, deferred.

## Conventions

- TypeScript everywhere, strict mode on.
- Server-side data access via Supabase server client (`@supabase/ssr`) in Server
  Components/Route Handlers; client-side via the browser client only where interactivity
  requires it (inline table editing, live search-as-you-type).
- Keep `bugs` and `master_bugs` field names identical where they overlap — this is relied on
  by the export and reuse-copy logic.
- Don't add new top-level tables without updating this file and `/supabase/schema.sql`.
- Don't write RLS policies ad hoc per feature — policies should be reviewed as a full set
  against the roles table above so permissions stay consistent across every table.

## PWA + push notifications

The app should be installable (Add to Home Screen / desktop install) and support browser push
notifications, even when the tab/browser is closed — one setup serves both, via a standard
manifest + service worker. This is **Web Push API only**, no Firebase/FCM, no native mobile
app — chosen to stay entirely inside the existing free stack (no new third-party account).

- **`push_subscriptions` table** (migration 003, not yet run): id, user_id (→ profiles),
  endpoint, p256dh, auth, user_agent, created_at. RLS: user can only manage their own rows.
- **VAPID keys** (self-generated, free, via `npx web-push generate-vapid-keys`):
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (client-side, used to subscribe), `VAPID_PRIVATE_KEY`
  (server-only, signs push payloads), `VAPID_SUBJECT` (a mailto: or URL identifying the app).
  Not yet generated/added to `.env.local` — do that before wiring up the subscribe flow.
- **`/public/manifest.json`** — name "Catalyst IT Solutions", short_name "Catalyst",
  `display: "standalone"` (installed app opens without a browser address bar), real icon
  files (192x192 and 512x512 PNG) — ask for a logo before building this, don't fabricate one.
- **`/public/sw.js`** — service worker handling `push` events (show notification with a link
  to the relevant bug/task) and `notificationclick` (focus/open the app at that URL).
- **Custom install button** — capture the browser's `beforeinstallprompt` event and expose a
  visible "Install Catalyst" button (e.g. in the header) rather than relying on each browser's
  inconsistent default install UI.
- **Send flow**: wherever a row is inserted into `notifications` (assignment, status_change,
  comment, sla_breach, retest_ready), also send a push to that user's rows in
  `push_subscriptions` via the `web-push` npm package. If a push fails with 404/410 (expired
  subscription), delete that row instead of retrying it.

Not yet implemented — this whole section is a spec for a future build step, not something in
the codebase yet.

## Commands

Deploying (Cloudflare Workers, gotchas, version log and rollbacks): the `catalyst-deploy` skill
(`.claude/skills/catalyst-deploy/SKILL.md`). **The database is shared by dev and prod: a migration is live
the moment it is applied, before any deploy.**

### aktrade automation connection
The API the aktrade test runner uses (`app/api/automation/**`: shared-secret auth `AUTOMATION_INGEST_SECRET` via `checkAutomationSecret`, service role) with its routes, runners, jobs, house mapping and history: `app/api/automation/CLAUDE.md`, which loads when working there.
- **Assisted, not automatic (decided):** the portal exposes bug data and queues only the jobs a person asked for. Never build unattended test generation or execution on it: the trading API it connects to can reach real withdrawals and password changes.
- **Auto-test reports (2026-09-30, migration 0039):** a whole-app auto-test is started only by a person on the runner PC (aktrade Development Portal), never from here (re-confirmed with the user 2026-09-30). The portal only receives its report (`automation_reports`) and shows it on the project's Automation tab. A finding becomes a bug only when a QA/admin clicks "File as bug". Details: `app/api/automation/CLAUDE.md`.
- **Every project may use "Send to automation" (decided)**, including projects with no house. Don't add a restriction without asking.
- `/api/automation` is in `PUBLIC_PATHS` (`lib/supabase/middleware.ts`) so the login redirect never catches runner calls; keep it there.
- House ↔ project: Android `projects.house_slug`; iOS `house_group` + `platform = 'ios'` (`lib/automation-release.ts::resolveProject`).

### Android/iOS sub-projects per house (2026-09-18)

Each of the 8 automated houses now has two catalyst projects, not one — a bug tracked for the
Android app and a bug tracked for the iOS app are different rows in different projects, since
they can legitimately diverge (an iOS-only crash isn't an Android bug). aktrade automation is
Android-only today, so nothing here changes the automation connection above — it only affects
how bugs are organized in catalyst.

- **`projects.platform`** (`'android' | 'ios'`, nullable) and **`projects.house_group`**
  (nullable, non-unique) — migration `0023_android_ios_sub_projects.sql`. `house_group` is the
  same value for both platform siblings of one house (equal to `house_slug`, e.g. `nxgyc`);
  `house_slug` itself stays set **only** on the Android project, since that's the only one
  wired to the automation API — the iOS sibling has `house_slug = null`. Existing projects
  named e.g. "Youngs Capital" became the Android project; a new "Youngs Capital (iOS)" project
  was created alongside it for each of the 8 houses.
- **Copy a bug to the other platform**: a "Copy to iOS/Android" button on the bug drawer
  (`components/BugDrawer.tsx`, `copyToSibling()`), shown when the project has a
  `house_group`/`platform` and a sibling project is resolved (`app/(app)/projects/[projectId]/bugs/page.tsx`
  queries `projects` by matching `house_group` + differing `platform`, passed down through
  `BugBoard` as `siblingProject`). Copies title/description/steps_to_reproduce/severity/
  priority/category into a new row in the sibling project; **does not** copy workflow state
  (assignee/due_date/status) — the copy starts fresh as `open`, same semantics as copying from
  the master library. `bugs.copied_from_bug_id` (self-referencing FK, `on delete set null`)
  is an informational-only pointer to the source bug, mirroring `base_page_id`'s "no live
  link" pattern — never treat it as a sync relationship.
- If a house that isn't platform-split is ever created (or a project has `house_group` set but
  no sibling exists yet), the copy button simply doesn't render — `siblingProject` resolves to
  `null` and nothing else needs to check for that case.

### Per-bug delete (2026-09-18)

`BugBoard.tsx` already had bulk delete (multi-select + a danger button), gated only on
`!isViewer(role)` in the UI with `bugs_qa_delete` RLS (`is_qa_or_admin()`) as the real
enforcement. Added a single-bug equivalent in `BugDrawer.tsx` (`deleteBug()`, a "Delete bug"
button with a native `confirm()`), gated on `isManager(role)` directly — the precise
app-level equivalent of the RLS policy, tighter than the board's existing `!isViewer` gate.
Deleting closes the drawer and refreshes the board; cascade behavior (comments, attachments,
notifications) is unchanged, already `on delete cascade` from the bug.

While building this, found `tasks.linked_bug_id` had no `ON DELETE` behavior (defaulted to
`NO ACTION`) — deleting a bug linked to a task would fail with a raw FK violation, silently
affecting the pre-existing bulk-delete too, not just this new button. Fixed in migration
`0024_tasks_linked_bug_set_null_on_delete.sql` (now `ON DELETE SET NULL` — a task outlives the
bug it referenced, same "historical pointer" treatment as `base_page_id`). Verified: deleting
a bug with a linked task now succeeds and the task's `linked_bug_id` is nulled, not blocked.

Also added a third delete entry point: a 🗑 icon per row in the Sheet (spreadsheet) view
(`deleteRow()` in `BugBoard.tsx`, same `confirm()` + `isManager(role)` gate as the drawer's
button) — the Sheet view previously only supported deletion via multi-select + the bulk toolbar
button, with no direct per-row action. The column is gated on `isManager(role)` and only
rendered (both the `<th>` and each row's `<td>`) for staff who can actually delete, not shown
and disabled for everyone else.

### Release-notes version parsing (2026-09-18)

The version-gate card's "Expected version" field can now be filled two ways: type it manually
(as before), or paste/upload release notes and parse the version out of them — either way it's
just a normal editable input before Save, a parsed result is a starting point, not locked in.

- **`lib/parse-version.ts`** — pattern-matching, not an LLM call, by deliberate choice (asked
  for explicitly: Gemini's free-tier rate limits are already a known pain point elsewhere in
  this app, and version numbers in release notes are formulaic enough that regex handles them
  reliably with no API cost, no rate limit, no network round-trip). Tries, in order: a
  "version"/"release"/"ver" keyword immediately followed by a number (checked in the first
  ~500 chars first, then the whole document — release notes almost always state the version
  prominently up top); a bare `vX.Y[.Z]` token; any bare `X.Y.Z` anywhere as a last resort.
  Unit-tested against 9 realistic formats including a decoy version number elsewhere in the
  text (correctly ignored in favor of the keyword-associated one).
- **`POST /api/release-notes/parse`** — accepts either `{text}` JSON (pasted notes) or
  multipart `file` (PDF/DOCX/TXT/MD, reusing the existing `lib/extract-text.ts` from the
  requirements-document pipeline). Regular user-session auth gated on `canAdminister`, same as
  the settings page itself — not the shared-secret automation auth, since this is called from
  the browser by whoever is editing the project. Stateless: nothing is persisted here, the
  parsed version/filename just pre-fill the existing form fields client-side.
- **`components/VersionGateCard.tsx`** — new client component (the version-gate card was
  previously a plain server-rendered form) so the parse result can update the version input
  before the existing `updateProjectVersion` server action runs on Save.
- Verified live in the browser against the real AKD Trade Pro project: both paste-text
  ("Version 1.0.9" → correctly extracted "1.0.9") and file-upload (a `.txt` with "Release 1.0.8
  Notes" → extracted "1.0.8", filename auto-filled as the release notes reference) worked
  end-to-end; the real `current_version` was left untouched by not clicking Save.

### Retest tab (2026-09-18)

New per-project tab, "Retest" (`ProjectTabs.tsx`, between Requirements and Settings; new page at
`app/(app)/projects/[projectId]/retest/page.tsx`) — a dedicated place to run a retest pass:

- Lists every bug currently `status = 'fixed'` **or** `'ready_for_retest'` for the project
  (both mean "needs a retest," whether or not someone remembered to flip it to ready first —
  widened from `ready_for_retest`-only on the same day this tab was built, on request). A
  Status badge column in `RetestList.tsx` distinguishes the two at a glance.
- The version-gate card (`VersionGateCard.tsx`) sits at the top, admin-gated, same as Settings
  — a shortcut so confirming/updating the version you're retesting against doesn't require a
  trip to Settings.
- **`components/RetestList.tsx`** (client component) — each row has an inline "Close" action
  (`canEditBug` gated, same permission as the drawer's own status buttons) that sets
  `status = 'closed'` directly from this list (no drawer round-trip); `closed_at` is set
  automatically by the existing DB trigger (migration `0003`/`0014`), same as any other
  close. "Reopen" is deliberately **not** offered inline — a failed retest usually needs a
  comment explaining why, so that still goes through the full bug drawer via the row's
  "Open →" link (`?focus=<id>`, the same query param `BugBoard.tsx` already reads).
- Verified live: closing a real ready-for-retest bug from this list correctly set
  `status='closed'` and `closed_at` in the database and removed it from the list on refresh.

### Master Bug Library split by platform (2026-09-21)

`base_page.platform` (`'android' | 'ios'`, nullable; migration `0026_base_page_platform.sql`) separates the
library into an Android list and an iOS list. `NULL` = **unassigned**: the 78 pre-existing manual entries
were deliberately not guessed at and show under an "Unassigned" tab with per-row "→ Android / → iOS" and an
"assign all" shortcut (`components/MasterLibrary.tsx`). Rows created by automation (`house_slug` set, and
new ones from `/api/automation/failures`) are `android`, since automation only drives the Android apps.
- Tabs with counts; New entry and Excel import choose a platform; "Copy to iOS/Android" makes an independent
  copy on the other platform (same no-live-link rule as project copies); export includes a Platform column.
- **Strict project link:** the Android list connects only to Android projects and the iOS list only to iOS projects (`projectMatchesEntry` in `MasterLibrary.tsx`; enforced in the dropdown and again in `copyToProject`). Unassigned entries can go to any project until classified. The 13 legacy projects that had no platform (ABBASI, AHL, Eclear ×2, FDM, Rafi securities, Tejoree, Yaqoob Habib, ABA Ali Habib, Al Habib Capital, Alpha (Tejoree), Habib Metro, SCS Trade duplicate) were set to `android` on 2026-09-21 by request, so every project now has a platform. They have no `house_group`, so they get no iOS sibling / copy-to-sibling button; new projects still start with no platform. A project's platform is set from its **Settings → Platform** card (`updateProjectPlatform` in `app/(app)/projects/actions.ts`, admin only); projects that are half of a house's Android/iOS pair (`house_group`/`house_slug` set) are locked there because the platform is what links them to their sibling and to automation.
- New-bug duplicate suggestions (`NewBugDialog`) come from the project's platform plus unassigned entries;
  the new-entry duplicate check inside the library is scoped to the chosen platform (the same bug title on
  Android and iOS is legitimate).
- Gotcha fixed while building this: the page's server-fetched `initial` list is the Android tab only, so it
  must not be re-applied on `router.refresh()` (it briefly emptied other tabs). The per-tab query owns the list.
### Deployment: Cloudflare Workers
Live at `https://catalyst.umerfarooqsqa.workers.dev`. How to deploy, the build gotchas, the version log and rollbacks: the `catalyst-deploy` skill. Test file/PDF/native-module features against the deployed worker, not only `next dev`.

### Android app (Trusted Web Activity)
`android-app/` wraps the live portal as an Android app; build, signing and assetlinks are in the `catalyst-android-app` skill. **Never lose `android-app/catalyst-release.keystore` (backup in `~/.catalyst-android/`): without it the app can't be updated in place**, and `public/.well-known/assetlinks.json` must keep its fingerprint.

### PDF text extraction on Workers: unpdf, not pdf-parse (2026-09-21)

Uploading a PDF (requirements document or release notes) failed on the deployed portal with **"DOMMatrix is not defined"**. `pdf-parse` v2 wraps `pdfjs-dist`, which needs a browser-style `DOMMatrix`; in Node it is supplied by the native `@napi-rs/canvas` add-on, which does not exist on Cloudflare Workers, so it worked in `npm run dev` and failed live. `lib/extract-text.ts` now uses **`unpdf`** (a serverless PDF.js build that runs on Workers); `pdf-parse` was removed from `package.json` and from `serverExternalPackages` in `next.config.ts`. Deployed as `a8641f2d-34a5-4762-8f8f-0bfdb60b4e31`. Verified: the same tiny PDF returned 400 "DOMMatrix is not defined" before and 200 (`1.0.101`) after on the live worker, and a real 5-page release-notes PDF extracts in a local `workerd` run. Lesson: **anything that works in `next dev` can still break on Workers — test file/PDF/native-module features against the deployed worker.**

## Open questions / decisions pending

- Full RLS policy set per role — not yet written.
- Whether attachments live in a public or private Supabase Storage bucket (currently assumed
  private, served via signed URLs — confirm before building upload UI).
- Notification delivery is in-app only for v1 — email/Slack integration not yet decided.