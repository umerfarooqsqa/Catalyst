-- Separate the Master Bug Library by platform (Android / iOS).
-- NULL = unassigned: manually-entered entries predating this change are not
-- guessed at; the library UI shows them under "Unassigned" until classified.
alter table base_page add column if not exists platform text check (platform in ('android','ios'));
create index if not exists base_page_platform_idx on base_page (platform) where source_type = 'master_bug';
-- Automation only runs against the Android apps, so bugs it filed are Android.
update base_page set platform = 'android' where house_slug is not null and platform is null;
