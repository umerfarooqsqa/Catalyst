-- REQ-14 gate: "the release-notes test points pass".
-- releases.claimed_bugs: the portal bugs the release notes claim are fixed
--   (written by POST /api/automation/release-notes).
-- automation_runs.test_results: per-test outcome of a run, [{key, status}], so the
--   gate can check that each claimed bug's test (test_bug_<id8>_*) passed in this release.
alter table public.releases add column claimed_bugs jsonb not null default '[]'::jsonb;
alter table public.automation_runs add column test_results jsonb not null default '[]'::jsonb;

comment on column public.releases.claimed_bugs is
  'REQ-14: [{claim, bug_id, bug_title, status}] -- bugs this release''s notes claim as fixed.';
comment on column public.automation_runs.test_results is
  'REQ-14: [{key, status}] per test of the run (key = pytest node id).';
