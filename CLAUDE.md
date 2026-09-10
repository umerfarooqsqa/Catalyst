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

- **Frontend + Backend:** Next.js (App Router), React, TypeScript
- **Database + Auth + Storage:** Supabase (PostgreSQL)
- **ORM / data access:** Supabase JS client (`@supabase/supabase-js` +
  `@supabase/ssr` for server components/auth)
- **Styling:** Tailwind CSS
- **Excel export:** SheetJS (`xlsx`)
- **Deployment target:** self-hosted (per company preference — no Vercel lock-in assumed)

Why this stack: one codebase for frontend+backend, Postgres for the relational
requirement→test case→bug traceability, and Supabase gives auth/storage/RLS/realtime out of
the box instead of hand-building each. Firebase/Firestore was considered and rejected — the
data model here is relational, not document-shaped.

## Supabase project

- Project ref: `jdzgctelcsrqocwmpngu`
- Project URL: `https://jdzgctelcsrqocwmpngu.supabase.co`
- Anon/publishable key (safe to expose client-side — RLS gates all actual data access):
  ```
  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkemdjdGVsY3NycW9jd21wbmd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5MjY0OTgsImV4cCI6MjEwNDUwMjQ5OH0.hze-44iK1BTGFWn-wpzGVzWB7qqeYMlBquqh4bLXS5U
  ```
- Publishable key (newer format, same purpose): `sb_publishable_eQfBXQ7xqrVmjMm4QGvqHw_rZVAUMuD`
- These belong in `.env.local` (gitignored — don't commit the file itself, even though the
  values above are safe to read) as:
  ```
  NEXT_PUBLIC_SUPABASE_URL=https://jdzgctelcsrqocwmpngu.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkemdjdGVsY3NycW9jd21wbmd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5MjY0OTgsImV4cCI6MjEwNDUwMjQ5OH0.hze-44iK1BTGFWn-wpzGVzWB7qqeYMlBquqh4bLXS5U
  ```
- **service_role key is NOT included here and is not currently used anywhere in this
  project.** If a future feature needs it (e.g. an admin-only server action that must bypass
  RLS), fetch it fresh from Supabase Dashboard → Project Settings → API, store it only in
  `.env.local` under `SUPABASE_SERVICE_ROLE_KEY` (no `NEXT_PUBLIC_` prefix, so it's never
  bundled client-side), and never write it into this file or any committed file.
- Schema was created via a single SQL script run in the Supabase SQL Editor (see
  `/supabase/schema.sql` in this repo for the canonical copy — keep it in sync with the live
  DB; any future schema change should be added as a new migration file, not by editing that
  file in place, once migrations are set up).

### Supabase client setup (once the Next.js app is scaffolded)

Two clients are needed — install with `npm install @supabase/supabase-js @supabase/ssr`:

- `lib/supabase/client.ts` — browser client, for Client Components (`createBrowserClient`
  from `@supabase/ssr`), reading `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- `lib/supabase/server.ts` — server client, for Server Components/Route Handlers
  (`createServerClient` from `@supabase/ssr`), wired to Next's cookie store so auth sessions
  persist server-side too.

Both read from the same two `NEXT_PUBLIC_*` env vars above — no separate server-only URL/key
needed unless the service_role key is introduced later.

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

## Data model reference

Core tables (see `/supabase/schema.sql` for full DDL, types, and constraints):

- `profiles` — extends `auth.users`, holds role/specialty
- `projects`, `project_members` — one project per app being tested
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
- `tasks` — open backlog (no sprints), optional link to a bug
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

For each new project, a client requirements document (PDF/DOCX) can be uploaded. Flow:

1. File uploads to Supabase Storage (bucket TBD — recommend a private
   `requirement-documents` bucket, one folder per project).
2. A `requirement_documents` row is created with `status = 'pending'`, linked to the project
   and the uploader.
3. A server-side route (Next.js Route Handler) extracts raw text from the file
   (`pdf-parse` for PDF, `mammoth` for DOCX) and sets `status = 'processing'`.
4. The extracted text is sent to an LLM with a prompt asking it to split the document into
   discrete, atomic requirements (title + description each).
5. Each extracted requirement is inserted into `base_page` as a `client_requirement` row:
   `source_type = 'client_requirement'`, `project_id` set, `requirement_document_id` set to
   this document's id.
6. `requirement_documents.status` is set to `completed` (or `failed` with `error_message` on
   parse failure), and `requirements_extracted` is set to the row count produced.

This needs a **server-only** API key for whichever LLM does the extraction — chosen provider is
**Google Gemini** (via Google AI Studio), for its free tier and JSON-mode structured output.
Configured: `GEMINI_API_KEY` is set in `.env.local` (project name `catalyst`, project number
`587815320834`). Never prefix it with `NEXT_PUBLIC_`, and only call it from a Route
Handler/Server Action, never from client code. Free-tier
rate limits change fairly often — confirm current limits there before relying on it beyond
testing, and design the extraction route to fail gracefully (mark the document `failed` with
`error_message` set) if the free tier is rate-limited rather than losing the upload.
Not yet decided: the exact prompt/output schema for the extraction call, and whether it should
also guess a category/severity per requirement using `bug_categories.keyword_hints` — flag
this to the user before building the extraction endpoint if it hasn't been settled.

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

(To be filled in once the Next.js project is scaffolded — e.g. `npm run dev`, `npm run
build`, `npm run lint`.)

## Open questions / decisions pending

- Full RLS policy set per role — not yet written.
- Whether attachments live in a public or private Supabase Storage bucket (currently assumed
  private, served via signed URLs — confirm before building upload UI).
- Notification delivery is in-app only for v1 — email/Slack integration not yet decided.