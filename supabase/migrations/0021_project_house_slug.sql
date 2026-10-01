-- 0021 — Connect catalyst projects to aktrade automation houses.
--
-- Adds projects.house_slug (nullable, unique) mapping a catalyst project to the
-- corresponding config.config.APPS key in the aktrade repo, so a bug logged
-- against a project can be traced to the right automation suite/credentials.
--
-- The data updates below are a one-time reconciliation, not a repeatable
-- pattern: they target specific existing project ids (fetched by name before
-- writing this migration) and are safe to leave in migration history even
-- though they will no-op on a fresh database with no seeded projects.

alter table public.projects add column house_slug text unique;

comment on column public.projects.house_slug is
  'Matches a key in aktrade''s config/config.py APPS registry (e.g. nxgyc). Null for projects with no corresponding automation.';

-- Known 1:1 matches, confirmed against on-device app labels via aapt (2026-09-18).
update public.projects set house_slug = 'akdtradepro' where id = '22f3a2bf-dc65-4e1e-a86f-c81b2a4e1bfd';
update public.projects set house_slug = 'nxgyc' where id = '510d146b-8f75-4cb6-a1ef-964d2a7922fe';
update public.projects set house_slug = 'nxgscs' where id = '70604326-545d-44cf-841b-aa728c081f42';
update public.projects set house_slug = 'nxgbel' where id = '0a705e6a-4b77-4608-b479-930774e5ca15';
update public.projects set house_slug = 'nxgjsgcl' where id = '294bf110-9a33-4148-915d-eea543e93017';

-- MRA split: rename the existing single "MRA" project to the D-Trade variant,
-- and create a new project for the Shariah-compliant "MRA Wiqaya" app.
update public.projects set name = 'MRA D-Trade', house_slug = 'nxgmradtrade'
  where id = '172796be-03e4-4bd7-b5e6-cfdbe1daa7d6';

insert into public.projects (name, house_slug, created_by)
  values ('MRA Wiqaya', 'shariahmra', '42ea0547-3ff4-4df8-a4c4-b017d6ea0fa0');

-- No existing project matched nxgufsl ("UBL Invest") -- create one.
insert into public.projects (name, house_slug, created_by)
  values ('UBL Invest', 'nxgufsl', '42ea0547-3ff4-4df8-a4c4-b017d6ea0fa0');
