-- =====================================================================
-- 0069: iOS projects get their app's bundle id (2026-11-03, the user: "now i have the mac book
-- and iphone both with me now its time to fully configure ios")
--
-- The Android projects have android_package (0056). The iOS sibling projects (0023) had no
-- app id at all, so the Mac runner could not tell which app on the iPhone is the project's.
-- The aktrade Mac runner reads each app's bundle id from the iPhone (scripts/ios_apps.py) and
-- sends it with "Add app" (POST /api/automation/projects, `bundle_id`); it can also be set on
-- the project's Settings page. One bundle id belongs to one project.
-- Nothing else reads it yet (App Store Connect checks are a separate, later piece).
-- =====================================================================

alter table public.projects add column if not exists ios_bundle_id text;
create unique index if not exists projects_ios_bundle_id_key on public.projects (ios_bundle_id)
  where ios_bundle_id is not null;
alter table public.projects drop constraint if exists projects_ios_bundle_id_format;
alter table public.projects add constraint projects_ios_bundle_id_format
  check (ios_bundle_id is null or ios_bundle_id ~ '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$');
