-- Split each automated house into separate Android/iOS catalyst projects.
-- aktrade automation only tests Android today, so house_slug (the automation
-- connection) stays on the Android project only; house_group is a shared,
-- non-unique key linking the Android/iOS siblings of the same house so the
-- UI can find "the other platform's project" to offer a bug copy into.

alter table public.projects add column platform text check (platform in ('android', 'ios'));
alter table public.projects add column house_group text;
create index projects_house_group_idx on public.projects(house_group);

comment on column public.projects.platform is
  'Which platform this project tracks bugs for (android/ios), when the house is platform-split. Null for non-platform-specific projects.';
comment on column public.projects.house_group is
  'Shared key linking a house''s Android/iOS sibling projects (independent of house_slug, which only the automation-connected Android project has).';

-- Historical pointer for "copy to the other platform" (bugs.base_page_id's
-- pattern) -- a snapshot copy, not a live link, same as the library reuse flow.
alter table public.bugs add column copied_from_bug_id uuid references public.bugs(id) on delete set null;
comment on column public.bugs.copied_from_bug_id is
  'If this bug was copied from a sibling platform project, the bug it was copied from (informational only, no live sync).';

-- Mark the 8 existing automation-connected projects as the Android side.
update public.projects set platform = 'android', house_group = house_slug where house_slug is not null;

-- Create the iOS sibling for each.
insert into public.projects (name, platform, house_group, created_by)
select name || ' (iOS)', 'ios', house_group, created_by
from public.projects
where platform = 'android' and house_group is not null;
