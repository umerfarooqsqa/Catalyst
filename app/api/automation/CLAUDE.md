# catalyst automation API (the aktrade runner connection)

(Moved from `catalyst/CLAUDE.md` and the deploy skill's log on 2026-09-29; loads when working under `app/api/automation/`. The decisions that must always apply are summarized in `catalyst/CLAUDE.md` under "aktrade automation connection".)

### aktrade automation connection (2026-09-18)

Catalyst is connected to the separate `aktrade` repo (Python/Appium + API test suites for
this same family of white-label trading apps), so a bug logged here with clear reproduction
steps is easy to hand to a QA engineer or a Claude Code session to turn into an automation
test case. This is deliberately **assisted, not automatic** — nothing here generates or runs
test code; it only exposes structured bug data. Do not build unattended test-generation/
execution on top of this without revisiting that decision (the API layer this connects to can
reach real trading-account actions like withdrawals and password changes).

- **`projects.house_slug`** (migration `0021_project_house_slug.sql`, nullable, unique) maps a
  catalyst project to a key in aktrade's `config/config.py` `APPS` registry (e.g. `nxgyc`).
  Most projects have no automation counterpart yet and are left `null`. The 8 currently-mapped
  slugs were confirmed against each app's real on-device label (via `aapt dump badging`), not
  guessed from project names — e.g. "MRA" was split into two projects (`MRA D-Trade` →
  `nxgmradtrade`, new `MRA Wiqaya` → `shariahmra`) because those are two separate apps that
  had been sharing one project, and a new `UBL Invest` project was created for `nxgufsl`,
  which had no catalyst project at all before this.
- **`GET /api/automation/bugs`** (`app/api/automation/bugs/route.ts`) — the read side of the
  connection. Takes `?house=<slug>` (+ optional `&status=`) or `?id=<bug-id>`, returns bugs
  with their `steps_to_reproduce` and metadata (severity, category, project). Auth is a shared
  secret (`AUTOMATION_INGEST_SECRET`, header `x-automation-secret`), not a user session —
  called server-to-server from the Python side, which has no catalyst login. Uses
  `serviceRoleClient()` (`lib/supabase/admin.ts`), exactly the "inbound webhook" case its own
  doc-comment describes.
- This route is added to `PUBLIC_PATHS` in `lib/supabase/middleware.ts` (alongside
  `/api/push/dispatch`) so the session-redirect middleware doesn't intercept it before the
  route handler's own secret check runs — **any future `/api/automation/*` route needs the
  same exemption or it will silently 302 to `/login` instead of running.**
- On the aktrade side: `fetch_bug_context.py` calls this endpoint and writes each bug as a
  markdown file under `bug_context/<house_slug>/` (title, steps, severity, plus a pointer to
  which test suite/fixtures it likely belongs in) — that file is what actually gets handed to
  a human or Claude Code to draft the test.
- **`projects.current_version` / `projects.release_notes_ref`** (migration
  `0022_project_expected_version.sql`) + **`GET /api/automation/version`**
  (`app/api/automation/version/route.ts`, same shared-secret auth, already in
  `PUBLIC_PATHS`) — REQ-2's version-gate source of truth. Editable per-project via a "Automation
  version gate" card on the project's settings page (`updateProjectVersion` server action in
  `app/(app)/projects/actions.ts`), visible only when the project has a `house_slug`. Seeded
  for all 8 houses from each app's real on-device `versionName` (`adb shell dumpsys package`).
  aktrade's `utils/release_notes.py` and akdapiautomation's `conftest.py` both call this before
  running: a confirmed mismatch aborts the whole session (`pytest.exit`); an unreachable
  catalyst or unset version warns and continues rather than blocking every run outright. The
  API-side check compares against the suite's *configured* `API_CLIENT_VERSION`, not a
  server-echoed value — no such field was found in `TickLoginServlet`'s response; revisit if
  one is ever confirmed.
- Duplicate empty project rows exist from an earlier bulk-seed (`Eclear` ×2, `SCS Trade` ×2,
  neither pair has any bugs/requirements/tasks) — flagged, not cleaned up; harmless to this
  feature since only one of each pair got a `house_slug`.

### Releases, automation runs, recurring bugs, completion email (2026-09-21)

Migration `0025_releases_automation_runs_recurring.sql`: `releases` (per project+version, status
`in_progress`/`done`, `discrepancies` jsonb, `notify_emails`), `automation_runs`, `projects.notify_emails`,
`bugs.{source,automation_key,release_id,recurring,occurrences}` (unique partial index on
`(project_id, automation_key)`), `base_page.{house_slug,recurring_count}`. RLS: authenticated read-only;
all writes go through the service role.

Routes (all shared-secret via `checkAutomationSecret`, all in `PUBLIC_PATHS`): `POST /api/automation/`
`runs`, `failures`, `release-notes`, `release-complete`. `lib/automation-release.ts::resolveRelease`
finds/creates the release for (house, version). Recurrence = a bug that was closed/fixed/ready_for_retest
fails again (reopened) or still fails in a later release -> upserted into `base_page` as `master_bug`.
`lib/release-cross-check.ts` is heuristic (bullet-line claims vs bug titles); output is a review aid.
`lib/email-server.ts` sends via Resend (`RESEND_API_KEY`, `EMAIL_FROM`); unconfigured = release still
marked done, email skipped and reported. Recipients: "Completion email recipients" field on the version
gate card. Completion is idempotent (second call returns `already_done`, no second email).
Verified live with curl and the Python client against throwaway versions (rows deleted afterwards).

### Auto-test reports (2026-09-30, migration 0039; applied 2026-10-01, deployed `438d9f04-b4f4-4866-af61-f9f4b8f4c5f0`)

- **`POST reports`** `{house, platform, run_id, version?, runner?, status, started_at?, finished_at?, cost_usd?, summary, report}`.
  - The runner's auto-test report (aktrade `utils/autotest_report.py`), at most 4 MB.
  - Upserted on (project, run_id), so a resend replaces it. Linked to the version's release if it exists; never creates one.
  - Returns `{report_id, project_id}`.
- **`POST reports/[id]/files`** `{platform, name, kind: excel|screenshot, content_type, b64}` (max 15 MB).
  - Stored in the private `automation-reports` bucket at `<project>/<report>/<name>`, replacing any file of that name.
  - Recorded in `files`; the workbook also goes in `excel_path`.
- **`GET requirements?house=&rows=1`:** the project's client requirements (id, title, description, severity, category, document) for the auto-test context.
- **No bugs on arrival (decided):** findings become bugs only through the report page's "File as bug" (`app/api/projects/[projectId]/reports/[reportId]/file-bug`, session auth). There, a QA/admin inserts the bug under their own session: source `automation`, `automation_key` `autotest:<run>:<n>` (dedupes), the report's release. The screenshot is copied as a normal attachment, and the finding is marked filed.
- **UI:** the report list is on the project's Automation tab (`AutotestReportList`). The report page is `projects/[projectId]/automation/reports/[reportId]` (`AutotestReport`), with:
  - stats and what the run learned from;
  - findings with screenshots and "File as bug";
  - the requirement coverage table;
  - past bugs re-checked on this app;
  - every test (expandable), the screen map, and learnings;
  - downloads: the run's workbook (signed URL) and "Export report (.xlsx)", six sheets built by `lib/export.ts::exportWorkbook`.
  - Hidden from developers like the rest of automation (RLS `not is_contributor() and can_see_project`).

### Requirements documents sent from catalyst (2026-09-30, not deployed yet)

- **`POST requirements/claim`** `{platform, runner, houses?}`: the oldest `pending` document of a project with an app on that platform (Android `house_slug`, iOS `house_group` + `platform = 'ios'`, as `resolveProject`), limited to `houses`.
  - The claim is a conditional update, pending → processing, so there is no double claim and no SQL function.
  - It returns the document with a 10-minute signed download URL, or `{document: null}`. A missing file is marked `failed` and skipped.
- **`POST requirements/[id]`** `{platform, status: processing|failed, error?}`: the runner reports a retry or a failure/discard.
  - Only processing/failed rows change. A completed or re-sent (pending) row answers 409, so a stale report can't undo a person's "send again".
- **`POST requirements` with `document_id`** completes that row instead of inserting a new one. It refuses a row from another project (404) or one already completed (409), and restores the old status if the `base_page` insert fails.

### App warnings, checked in the cloud (2026-10-26, migrations 0055 + 0056 applied, deployed `47118b70`; replaces the same day's runner-pushed Play versions)
Decided with the user: every warning about an Android app is a card in My Queue for admins and QA, and nothing depends on a tester's PC. The runner route `POST play-versions` (0055) was removed; `play_versions` stays as the Play facts table, now written by the cloud job.
- **Clock:** `pg_cron` job `catalyst-app-monitor` (every 5 min) → `app_monitor_sweep()`. It raises/clears "checks have stopped" per app (`stale_minutes`, so a dead Worker is visible), then pings the Worker when a check is due (`app_monitor_kick`: pg_net POST `monitor_url` with header `x-monitor-secret`, both in `private.settings`).
- **Worker:** `POST /api/monitor/run` (`lib/monitor/run.ts`, in `PUBLIC_PATHS`, secret checked against the DB through `monitor_setting`). It claims due checks one at a time (`monitor_claim`, skip locked; a claim older than 10 min is taken back) for ~20 s and reports each (`monitor_done`: next run after `play_minutes`/`vitals_minutes`, a failure retries in 15 min, doubling).
  - `play`: Play releases (edit opened and deleted, `tracks/production`, plus `tracks.releases.list` for the review state), writes `play_versions`; target API (`target_api_rules` × `releases.target_sdk` of the live and the current version); portal (no current version, no release notes, critical bugs open on the live version).
  - `vitals`: Play Developer Reporting API, DAILY in America/Los_Angeles up to `freshnessInfo`: user-perceived crash/ANR 28-day rates overall and per phone model (≥ `device_min_users`), stuck background wake locks, `anomalies` of the last 7 days, and crash clusters first seen in the live build (`errorIssues:search`). Amber at `early_share` of a limit, red over it.
  - **Google auth:** `lib/monitor/google.ts` signs an RS256 JWT with WebCrypto from the key in Vault (`play_key_secret`, service role only) and caches the token 55 min. No Google libraries.
  - **Which key:** `play_key_apps`, filled from each key's Reporting API `apps:search` (re-listed after a day when an app has no key), else each key is tried directly with an edit.
  - **Never clears a real card by accident:** when Google can't be read, the source is left as it was and a `monitor_*` warning says why.
- **Instant re-checks:** triggers on `projects.current_version` / `android_package` / `platform` and `releases.target_sdk` / `release_notes_ref` → `monitor_request` (the app's `play` check due now + kick).
- **Warnings:** `app_warnings` (one row per project + fingerprint). `app_warnings_sync(project, source, items, clear)` inserts new ones, refreshes ones still true, marks missing ones cleared (`active = false`, still open), and reopens closed ones that are true again. New, reopened or amber→red ones call `app_warning_notify`: the bell (`notification_type` `app_warning`, `notifications.related_warning_id` → `/my-queue#w-<id>`) for every admin and manager who can see the project; critical ones also go straight into `email_outbox` (kind critical, honouring `notification_emails` and opt-outs; `lib/email-render.ts` words them as app warnings). People close cards with `app_warning_close` (QA/admin).
- **Play Console emails:** `POST /api/intake/play-mail` (header `x-play-mail-key` = `private.settings` `play_mail_key`), sent by the Google Apps Script shown on Admin → Google Play. Each Gmail message is stored once (`play_emails`); one naming an app (package, else one project's name, `lib/monitor/rules.ts::matchMailProject`) becomes a card per mail thread (never cleared by itself). Unmatched ones are assigned on the admin page.
- **Admin → Google Play** (`app/(app)/admin/google-play`): upload keys (Vault, `play_key_put`/`play_key_delete`, admin only), monitoring on/off (`app_monitor_config.enabled`, off until the keys are in), run now, thresholds, target API rules, the Apps Script, unmatched emails, history.
- **Runner (read-only):** `GET app-warnings?house=` returns the open warnings and the Play facts for the aktrade start gate.
- **Versions:** `releases.target_sdk` (VersionsPanel "API n", add-version field, `release-notes/add` `target_sdk`); `projects.android_package` (Settings; seeded `com.catalyst.<house_slug>`; `projects` POST `package`).
- **Tested** on PGlite with a stub schema (29 checks: queue, claim, sync/clear/close/reopen, notify recipients and email opt-out, Vault keys, stale sweep) and the rules with 27 unit cases. Live: migrations applied, routes answer 401 to wrong secrets, a rolled-back sync on ZLK gave 5 bells + 4 emails. The Google side runs once the keys are uploaded and monitoring is switched on (Admin → Google Play).

- **First live run (2026-10-26) and migration 0057:**
  - **Cloudflare's per-run request limit (~50 subrequests; every Supabase and Google call counts):** the first Worker looped over checks for 20 s and died with "Too many subrequests" after ~3 apps. Now one check per invocation (`runMonitor`), and the sweep pings the Worker once per due check, at most 8 per sweep; "Run checks now" pings 8 times. A check needs ~20-25 requests. Key listing is capped at `KEYS_PER_RUN` = 2 keys per run; while keys are still unlisted the check is "pending" (retried, no card).
  - **No keys at all → no cards:** monitoring was switched on before the keys were uploaded, and every app got red "can't be checked" cards, each emailed to every admin and QA (112 emails). Now a missing key set is only an error on the check (Admin → Google Play shows it).
  - **Monitor-health cards** (`monitor_*` sources) ring the bell but are never emailed, and close themselves once the check works again ("Closed by itself: the check works again."). App cards still wait for a person.
  - **Verified:** the Reporting API answered from Cloudflare (`apps:search`: the 14 keys reach 40 apps; catalyst 22, abbasi 6, arifhabib 6). PGlite tests now 33 checks.

- **Who and what (2026-10-26, migration 0058, decided with the user; replaces "admins and QA"):** only **serious** problems (severity critical, from the app's own checks: releases, vitals, target API, portal, Play Console emails) become cards, bells and emails, and only for the **App health** role category (`role_categories.app_health`; members = `profiles.skills`, managed on Admin → Role categories; seeded: Umer Farooq). Amber warnings, "version has no release notes" (now amber: a QA reminder, not an app problem) and the monitor's own problems are listed on Admin → Google Play only. App health members see and close cards even at developer level (`in_app_health()` in the RLS policy and `app_warning_close`).

- **Play Console "Policy status", and every app in the accounts (2026-10-27, migration 0059, decided with the user):** the user's goal is that page ("App not available to new users on Android versions higher than your target API level", "App updates with these issues will be rejected ... Fix by Nov 1"). Google has no API for it, so:
  - **Target SDK is read from Play, not typed in.** `lib/monitor/apk.ts` lists the build's generated APKs (`generatedApks`, allowed with "View app information"), downloads only the first 256 KB of the base APK (Range; ~10 KB is used) and reads min/target SDK from `AndroidManifest.xml` (binary XML, by attribute resource id). Once per build, into `play_builds`. Checked against aapt on JS 1.0.13 (min 26 / target 36). Apps uploaded as plain APKs have no generated APKs: "target SDK unknown" (amber), and `releases.target_sdk` is the fallback.
  - **Cards in Play Console's words** (`targetApiWarnings`): red "App not available to new users …" (live below the rule for existing apps), red "App updates will be rejected: must target Android 16 (API level 36). Fix by Nov 1, 2026 (N days away)" (live below the rule for updates; `target_api_rules.extended_to` = Google's extension), red when the version QA is testing would be refused, amber for a deadline within `target_warn_days`. A suspended app (Play's API answers "The app is suspended") is a red "App is suspended on Google Play".
  - **Every app the keys reach gets a project** (decided: create one, not a project-less card). `play_app_claim` → the Worker reads the Play Store title → `play_app_adopt`: an Android project with the same name and no app is linked, else a new project `added_from_play` (name taken → "Title (package)"). One app per Worker run; the sweep also pings while apps wait. Such projects skip the portal checks (no versions or notes there).
  - **What was found (2026-10-27, read from this PC):** every catalyst project's live build targets API 36. The Policy status issues are on older apps in the same accounts: API 34 or lower on com.catalyst.scs 5.5.4, com.catalyst.tick 5.5.7, com.catalyst.eclear 3.2, com.catalyst.ahcml 5.6, com.catalyst.alfaadhi 5.0.3, com.catalyst.fdm 5.7, com.catalyst.hmfs 1.0.2, com.catalyst.hmfsit 1.0.3, com.catalyst.nxgfdm 0.39.103, com.catalyst.nxgmaksl 0.33.5. About 16 live apps are APK uploads; com.directfn.mobile.jsg is suspended.
  - **Still only by email:** the rest of Policy status (Data safety, permissions declarations, ...) has no API; it arrives through the Play Console emails (Apps Script above).
  - **Tested:** PGlite, 18 checks (`play_builds` RLS, extension constraint, claim never repeats within the hour, link by name / new project / "(package)" fallback / never two projects per package, sweep pings for waiting apps); rules with the user's own example.

- **Fixes from the 2026-10-27 test run (migration 0060, asked by the user: "why don't notifications arrive when my PC is off"):** the cloud ran all night; delivery and the monitor's own reporting were at fault.
  - **Cards:** one closed while its problem is still true stays closed (acknowledged) and reopens only after the problem cleared and came back (before: reopened + emailed hourly). Amber warnings close themselves when no longer true. Amber→red re-notifies at most once a day. "Checks have stopped" (`monitor_stale_*`) now rings App health and shows in My Queue.
  - **Emails:** app warnings found within a minute go out as one email (`app_warning_email`); a failing insert for one person no longer drops everyone's bell.
  - **Checks:** a check that couldn't read Google is a failure now (`{ok, note}`; before it set `last_ok_at`, so the stale alarm never fired); a run that died (claim > 10 min) counts as a failed attempt with back-off; a re-check requested during a run survives `monitor_done`; pg_net waits 120 s; one failed Play read or a partial vitals read keeps the existing cards (last known live build; `p_clear = false`).
  - **Keys and apps:** every key is re-listed daily as its own run (`refreshDueKey`; before, only while some app had no key, so new apps were never adopted); a key that lost access (404/403, not "Cloud project already in use") is unmapped; fallback keys are tried in random order; a deleted or unlinked adopted app isn't adopted again (`play_apps_ignored`).
  - **Rules:** live build found by its code (custom release names); `1.0.6-hotfix` names; an app whose only release is a staged rollout has a live version; no "version mismatch" when QA already moved past the version still rolling out; one red card when the live and tested versions break the same rule; rates at the limit are red and shown with two decimals; per-model cards up to 10; Pacific date for deadlines.
  - **Play Console emails:** a card per email (not per thread), on every app a mail names (whole package names; longest app name wins); a mail naming no app rings App health (`play_mail_unmatched_notify`); severity matches "suspended/suspension/rejected/terminated/not approved/target API/data safety/declaration/verify your identity/account closed" and no longer a bare "deadline"; the route takes 10 mails per call (`accepted`) and the Apps Script sends oldest first in batches, advancing only past what catalyst took.
  - **Tested:** PGlite 25 checks for 0060 (plus the 0058/0059 suites on top of it); probing unit tests on the live project list.

### Bug Library, export and all-bugs routes

- REQ-14 bug-library API built 2026-09-24: `GET /api/automation/bug-library?house&platform[&version]` (read-only, shared secret). It returns `master_bug` rows on that platform's list that have `house_slug = house` or were copied into the house's project (`bugs.base_page_id`). With `version`, it also returns the release status and the REQ-14 **gate** (`lib/regression-gate.ts`, pure function). The gate passes when every bug in `releases.claimed_bugs` (written by `release-notes` via `claimedBugs()`, same matching as the cross-check) has its most recent `test_bug_<id8>` result in this release's `automation_runs.test_results` (sent by `runs` as `tests: [{key, status}]`) equal to `passed`. Unassigned rows are excluded. Migration `0033_req14_claimed_bugs_and_test_results.sql` adds the two jsonb columns. Migration applied and deployed 2026-09-24 as version `1f0f6ad2-6b84-48e1-844b-6b2d14d5f7dc` (previous: `a8641f2d-34a5-4762-8f8f-0bfdb60b4e31`). Verified live with a throwaway release, deleted afterwards. The gate went from "no test run" to "failing" to "passed" as runs were pushed.

- **`GET/POST /api/automation/bugs/export`** (2026-09-29, `app/api/automation/bugs/export/route.ts`; deployed `00db2094`): "Export to catalyst" from the aktrade dashboard, like the Bug Library's "Copy to project…".
  - **GET** `?house=&platform=` returns the house's project, its versions and the severities.
  - **POST** files one bug in the house's project with source `automation`, status open and the chosen release. That release must already exist, except the project's current version, which is created on first use.
  - **Dedup:** with `key`, a bug already exported under that key in the project is returned (`status:"exists"`) instead of a duplicate. `force` files a new one with a suffixed key. Keys are the test node id (the same key the `failures` route uses) or `finding:<run>:<n>`.
  - **Screenshot:** an optional PNG/JPEG, 8 MB max, becomes an attachment with `uploaded_by` null.
  - Uses the shared secret and the service role; no migration needed.
- **Frontend/backend `area` (2026-10-01, migration 0041):** `failures` takes `area` per failure and `bugs/export` takes `area` (GET also returns `areas`), both `frontend`/`backend`. Without it, the area comes from the test path (`lib/bug-area.ts::areaFromTestKey`: `akdapiautomation/` = backend, `tests/` = frontend), else it is left for QA. Only new bugs get it: `failures` never changes an existing bug's area. The new bug goes to that area's project developer (`trg_bugs_default_assignee`). A recurring bug's Bug Library entry gets its area when the entry has none.
- `GET /api/automation/all-bugs?platform=android` (2026-09-24, deployed `b855824a-decd-4b1e-8b6b-307f49371843`; previous `1f0f6ad2-6b84-48e1-844b-6b2d14d5f7dc`): read-only, shared secret. It returns every bug of every project on the platform, including projects with no house, with `base_page_id` and project info. The aktrade runner turns them into one shared test suite. Verified live: 78 Android bugs, none from iOS.

### Automation routed by platform: Android → Windows runner, iOS → Mac runner (2026-09-21)

Migration `0027_automation_runners_and_jobs.sql`: `automation_runners` (name, platform, os, `last_seen_at`; a check
constraint enforces Android⇒Windows and iOS⇒macOS) and `test_jobs` (project, platform, bug, status
`queued|claimed|generated|failed|cancelled`, runner, note, `generated_tests` jsonb; a partial unique index allows only one
active job per bug). `claim_test_job(platform, runner)` is an atomic SQL function (`for update skip locked`, service role only) so a
job is never handed out twice and a runner only receives its own platform's jobs.
- **Project resolution** (`lib/automation-release.ts::resolveProject`): Android → `projects.house_slug = house`; iOS →
  `house_group = house and platform = 'ios'`. All `/api/automation/*` routes (`bugs`, `version`, `runs`, `failures`,
  `release-notes`, `release-complete`) accept `platform` (default `android`, so the existing Windows setup is unchanged);
  automation-created Bug Library entries take the platform of the project they came from.
- **Add app (2026-09-28)**, `/api/automation/projects`:
  - `GET ?unmapped=1&platform=` lists the projects with no app linked.
  - `POST {house, name, platform, version?, project_id?}` gives a house added by name in aktrade's Development Portal its project. If the house is already mapped, it returns `existing`. Otherwise it links `project_id` (or a same-named project with no house) and returns `linked`, with a 409 if that project already has another house. Failing both, it inserts a new project and returns `created`.
  - The house goes in `house_slug` on Android and `house_group` on iOS; the version is filled in only if it was empty.
  - This replaces hand-written mapping migrations (0021, 0028-0030) for new apps.
- **Runner routes**: `POST runners` (register + heartbeat; rejects a wrong platform/OS pair with 422), `POST jobs/claim`
  (`{runner, platform}`; 403 if the platform differs from the runner's registration), `POST jobs/[id]` (only the claiming runner can
  finish a claimed job, once). Auth is still the single shared `AUTOMATION_INGEST_SECRET` (decided; per-platform secrets are a
  possible later hardening — until then platform separation is enforced by these checks, not by separate credentials).
- **UI**: `/automation` (`components/AutomationBoard.tsx`, sidebar link "Automation") — two lanes with runner online/offline (heartbeat
  < 2 min), queue counts, job history, Cancel for queued jobs, and "Queue all open bugs" per project (each lane offers only that
  platform's projects). Bug drawer: "Send to automation" (manager+) with a status badge; jobs are created by the user, never
  automatically (decided). iOS projects now also show the Automation version gate card (each has its own `current_version`).
- Jobs are created with the user's own session under RLS (`is_qa_or_admin()` and `platform` must equal the project's platform);
  runner writes use the service role.
- Verified live with curl and in the browser against throwaway data (all removed): wrong OS/platform pairs rejected, claims never
  cross platforms, no double claims/completions, iOS runs/failures land in the iOS project and stamp the iOS Bug Library list.

### Automation features (from the deployment log)

- **Project automation folders** (deployed `553a2e5b-a7f5-4518-bcd6-187aabecf951`, migration `0032_project_automation.sql`): each project that has a house is linked to its own folder on the runner, `projects/<platform>/<house>/` in the aktrade repo. `project_automation` (project_id, runner_name, folder, tests_total/approved/pending, last_run_at, last_synced_at) is written only by the runner via `POST /api/automation/folders`; `GET /api/automation/projects` lists the 23 projects with an app (used to build the folders). New per-project **Automation** tab (`ProjectTabs.tsx`, `app/(app)/projects/[projectId]/automation/page.tsx`, `components/ProjectAutomation.tsx`): linked folder + stats, runner online state, this project's jobs and the same actions as the Automation page (whole project / all open bugs / a single bug). A project with no house shows the "no app linked" explanation and no send buttons there (the bug drawer and Automation page still allow sending, per decision). iOS projects show "not reported by a runner yet" until a Mac runner syncs.
- **Send one bug / automate the whole project** (deployed `5da209a1-3bfb-4e05-add2-aaf5e73c5061`, migration `0031_one_active_whole_project_job.sql`): on the Automation page each lane has a project picker with three actions: **Automate whole project** (a `source_coverage` job with no bug: the runner writes as many read-only tests as it can for the whole app from its source; one active per project, enforced by a partial unique index), **Queue all open bugs (N)**, and **Send a single bug…** (pick from the project's open bugs; bugs already in automation are disabled). The bug drawer's per-bug "Send to automation" remains. Whole-project jobs show a "Whole project" badge. Runner side: the job file is `generation_jobs/<house>/00_source_coverage.md` (carries `job_id`, never overwritten by the local source-job writer), and "Report generated" attaches every generated test for the house that is not `test_bug_*`.
- 2026-09-21: two more houses (migration `0030_map_eclear_and_tradin.sql`): `nxgeclear` (Eclear NxG Tick v0.50.607 -> the older of two identical empty `Eclear` projects; the other was deleted) and `tradin` (Tradin One v1.0.5 -> a **new** project, 'Tradin One', because no existing project matched; move its bugs/rename if it actually belongs to an existing project). The duplicate Eclear project (empty, unmapped) was deleted at the user's request. 15 houses now; 5 Android projects still have no house and no installed app: ABBASI, FDM, Habib Metro (HMFS), Rafi securities, SCS Trade (an empty duplicate of the mapped `nxgscs` project).
- 2026-09-21: four more houses mapped (migration `0029_map_four_more_houses.sql`): `abaali` (ABA ALI HABIB SECURITIES, v1.0.3), `nxgahcml` (Al Habib Capital Market, v1.0.8), `nxgahletrade` (AHL, v1.0.7), `nxgyh` (Yaqoob Habib, v1.0.6). 13 houses now; 7 Android projects still have no house (ABBASI, Eclear x2, FDM, HMFS, Rafi securities, SCS Trade duplicate).
- **No-app warning** (deployed as `e0a3162a-ff10-4dd1-a752-6ea4b398fa13`): sending is allowed for every project (decided), but the bug drawer shows an amber notice when the project has no house, the Automation page shows a lane banner, a per-job "⚠ no app linked" line and a "— no app linked" suffix/notice in the queue-all selector, and the runner's dashboard flags such jobs (Queue page, fetch notice, `_unmapped` job folder). The drawer shows "Checking…" until the project/job lookup returns, so it never flashes "No platform set".
- 2026-09-21: the **Tejoree** project is mapped as the 9th house (`house_slug`/`house_group` = `nxgac`, Android, `current_version` 1.0.2; migration `0028_map_tejoree_house.sql`). It has no iOS sibling project yet.
- 2026-09-21 (later): version `159e42ef-6fa3-4331-9f9d-e98143fa991a` adds `GET /api/automation/jobs` (read-only platform queue listing for the runner's dashboard). **Decided (user): every project may use "Send to automation", including projects with no house** (`house_slug`/`house_group` unset). Such a job is queued and claimable, but the runner cannot generate tests for it until the project is mapped to an app (e.g. Tejoree was mapped as house `nxgac` for this reason); the runner's Queue page flags it "no house set". Do not add a restriction without asking.
