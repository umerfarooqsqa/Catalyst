---
name: catalyst-deploy
description: Deploy the catalyst portal to Cloudflare Workers (npm run cf:deploy), its build gotchas, secrets caveat, deployment version log and rollback commands. Use before deploying catalyst or rolling it back.
---

(Moved from catalyst/CLAUDE.md on 2026-09-29.)

### Deployment: Cloudflare Workers (2026-09-21)

Live at `https://catalyst.umerfarooqsqa.workers.dev` (worker `catalyst`). Deploy with `npm run cf:deploy`
(`opennextjs-cloudflare build && deploy`); the DB is the same Supabase project for dev and prod, so migrations applied via MCP are already live.
- Deployed 2026-09-21: version `fd450df1-0877-42d5-99f4-d1a0a925652e` (platform routing, Automation page, platform-split Bug Library).
  Previous version for rollback: `45473508-e9da-48d5-ac89-9c8e7842de29` (`npx wrangler rollback 45473508-e9da-48d5-ac89-9c8e7842de29`).
- Deployed 2026-09-28: version `62bdb00d-3450-4647-a024-9f11e487ff94`. It adds the "📱 Take phone screenshot" button on bugs, and the CSP `connect-src` now allows `http://localhost:217` and `http://127.0.0.1:217`. It also ships the REQ-14/failures changes: a failing `test_bug_<id8>` updates the original bug, `steps_to_reproduce` is filled in, the gate reports "skipped", and `release-complete` carries the gate verdict. Rollback: `npx wrangler rollback b855824a-decd-4b1e-8b6b-307f49371843`.
- Deployed 2026-09-28 (later): version `3930766d-424d-4531-b829-772472ebc3bf`, the formatted Excel export with embedded bug screenshots. Rollback: `npx wrangler rollback 62bdb00d-3450-4647-a024-9f11e487ff94`.
- Deployed 2026-09-28 (Add app): version `39d07f27-7990-4406-bead-a3391c492676`, POST/GET-unmapped on `/api/automation/projects`. Rollback: `npx wrangler rollback 3930766d-424d-4531-b829-772472ebc3bf`.
- Deployed 2026-09-28 (release notes): version `ff34f310-1a3e-47e0-8fad-1609732cb492`. Rollback: `npx wrangler rollback 39d07f27-7990-4406-bead-a3391c492676`.
  - **Storage:** release notes are stored per version with no schema change (`lib/release-notes.ts::saveReleaseNotes`). The document goes in the `attachments` bucket under `release-notes/<project>/<version>/`, with its path in `releases.release_notes_ref`. The project's `current_version`/`release_notes_ref` follow the newest notes, and the REQ-6 cross-check runs on save.
  - **Routes:** `POST /api/automation/release-notes/add` (secret; `preview` mode just reads the version) and `POST /api/projects/[id]/release-notes` (session, manager+). `GET /api/automation/version` now returns `has_release_notes`: the aktrade runner won't start testing without it.
  - **Settings page:** the "Release notes & version gate" card (`VersionGateCard`) adds and lists the notes.
  - **Bugs:** each bug's app version is `bugs.release_id` → `releases.version`. The bug board has a version badge, a filter and an "App Version" export column. NewBugDialog picks the version (default: the current one), and the drawer changes it.
- Deployed 2026-09-29: version `00db2094-2ea6-4832-a887-f4fcfa5c5108`.
  - **Includes:** migration 0034 (platform visibility, developer rights, comments), the bug-export and requirements routes, the requirements move off Gemini, and Copy to project for QA only.
  - **Verified live, in rolled-back transactions as real users:** an iOS developer sees only the 10 iOS projects and no Android bugs; an Android developer sees only the 19 Android projects. A developer's close, title edit and delete are refused, and marking a bug fixed works.
  - Rollback: `npx wrangler rollback ff34f310-1a3e-47e0-8fad-1609732cb492`. This does not undo the migration.
- Deployed 2026-09-29 (mobile UI pass): versions `d79e5a33-725a-4dbc-9ad4-437115c08d86`, then `d863f21a-833c-4448-8691-22715bc199ee`. Tested on a phone (1080x2400, 345 CSS px wide) through Chrome remote debugging over USB. Rollback: `npx wrangler rollback 1827c7ff-990d-4d18-94df-74b900c43003`.
  - **Logo:** the "C" badges in the top bar, sidebar and login page are now `public/brand/logo-mark.png`, a transparent, cropped copy of aktrade's `logomain.png`.
  - **Overflow and grids:** `.grid > * { min-width: 0 }` in `globals.css` fixes the dashboard grid blowout, where a long title widened the column past the screen.
  - **Shared components:** `Stat` values align when a label wraps, `Badge` no longer wraps, and `Fab` adds bottom room so it never covers the last row.
  - **Bug Library:** entry actions stack under the entry on phones.
  - **Tables on phones:** Projects hides Description, Created and delete below `sm`. Admin → Users and the Audit log render cards on phones.
  - **Other pages:** project tabs scroll the current tab into view and fade while more are hidden, the bugs keyboard hint is desktop-only, and the Settings subtitle wording is updated.
- Deployed 2026-09-29: `e036fdbd-a9c5-4687-bd69-ff8f7fc7ef49`. It removed the login page's "Show demo accounts" panel, which listed `*@catalyst.test` logins with a shared password. None of those accounts exist in auth. Rollback: `npx wrangler rollback 0f33cfb1-fa83-41ba-9a73-35cfa05b1a48`.
- Deployed 2026-09-29: `eaf7d8cc-2b16-40b1-a994-2319ffb5f483`, a login redesign with no sign-up. Rollback: `npx wrangler rollback e036fdbd-a9c5-4687-bd69-ff8f7fc7ef49`.
  - **Page:** the wordmark (`public/brand/logo-wordmark.png`, from aktrade's `logo.png`), a card on a soft brand gradient, inputs with icons, show/hide password, a spinner, and friendlier error text.
  - **Sign-up is gone** from the UI. Accounts come only from Admin → Users.
  - **Open issue:** Supabase Auth still has `disable_signup: false`, so the public API can still create accounts. The Management API token got 403 on PATCH `config/auth`, so it has to be switched off in the dashboard (Authentication → Sign In / Providers → "Allow new users to sign up").
- Deployed 2026-09-29: `e0b71bfe-6c1b-49e6-abb3-56d2b547c267`. My Queue shows bugs and tasks as cards (one column on phones, 2–3 wider) instead of a spreadsheet: badges and due/overdue chip, title, project, then Start / Mark fixed / Mark done and Open. Rollback: `npx wrangler rollback eaf7d8cc-2b16-40b1-a994-2319ffb5f483`.
- Deployed 2026-09-29: `99d3b7ea-a59d-43c7-85a4-9250b43dcfc5`. Bug screenshots now show inside the bug (`components/AttachmentGallery.tsx`): thumbnails and a full-size viewer, with signed URLs fetched up front in one `createSignedUrls` call. Before, tapping an attachment awaited a signed URL and then called `window.open`, which browsers (the installed app especially) block as a pop-up. The Gemini host was also dropped from the CSP `connect-src`. Rollback: `npx wrangler rollback e0b71bfe-6c1b-49e6-abb3-56d2b547c267`.
- Deployed 2026-10-01: `438d9f04-b4f4-4866-af61-f9f4b8f4c5f0`. Migrations 0037, 0038, 0039 and 0040 were applied first (Management API), since the code reads 0037/0039/0040 columns. It ships everything pending in the working tree, including lead/junior developers (0040), app versions + bug confirmation (0037) and auto-test reports (0039). Rollback: `npx wrangler rollback 99d3b7ea-a59d-43c7-85a4-9250b43dcfc5` (does not undo the migrations).
- Deployed 2026-10-01: `81f2f167-b1fc-4b53-8f6b-827582b4079b`, frontend/backend bugs (migration 0041, applied first). Rollback: `npx wrangler rollback 438d9f04-b4f4-4866-af61-f9f4b8f4c5f0` (does not undo the migration).
- Deployed 2026-10-01: `87a0ab75-b44c-4f08-977b-78f94dfaf14e`, skills + four bug areas (migration 0042, applied first) and the admin "waiting for you to verify" queue. Rollback: `npx wrangler rollback 81f2f167-b1fc-4b53-8f6b-827582b4079b` (does not undo the migration).
- **Stop `npm run dev` and delete `.next` before building.** A running `next dev --turbopack` leaves Turbopack output in `.next`, and
  `next build` then fails with `Cannot find module '../chunks/ssr/[turbopack]_runtime.js'`.
- **Known issue — secrets baked into the bundle:** OpenNext copies `.env.local` into the worker (`.open-next/cloudflare/next-env.mjs`), so
  `AUTOMATION_INGEST_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` are plaintext inside the deployed script (private to the
  Cloudflare account, but not the Secrets store). `wrangler secret list` shows only `SUPABASE_SERVICE_ROLE_KEY` and `VAPID_PRIVATE_KEY`. The
  automation API works because of the baked value. Proper fix: move `.env.local` aside while building and `wrangler secret put` each
  of the three (plus `RESEND_API_KEY`/`EMAIL_FROM` when email is wanted).
- Windows builds print an OpenNext "not fully compatible with Windows" warning; the build and deploy still succeeded.
