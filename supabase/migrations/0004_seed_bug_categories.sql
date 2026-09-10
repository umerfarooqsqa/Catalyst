-- =====================================================================
-- 0004 — Seed the default bug category templates.
-- These give the "select a category -> pre-fill steps + default severity"
-- and "auto-severity from keyword hints" features something to work with
-- out of the box. Admins can edit/extend them in the app.
-- =====================================================================

insert into public.bug_categories (name, default_severity, template_steps, keyword_hints) values
  ('Login / Auth', 'critical',
   E'Preconditions:\n- \n\nSteps:\n1. Navigate to the login page\n2. Enter <credentials>\n3. Submit\n\nExpected:\n- \n\nActual:\n- ',
   array['login','sign in','password','session','logout','auth','token','403','401']),
  ('Payment / Billing', 'critical',
   E'Preconditions:\n- Test card: \n\nSteps:\n1. \n2. \n3. Complete checkout\n\nExpected:\n- \n\nActual:\n- ',
   array['payment','charge','invoice','refund','checkout','card declined','double charge']),
  ('Data / Sync', 'major',
   E'Preconditions:\n- \n\nSteps:\n1. \n2. \n\nExpected data:\n- \n\nActual data:\n- ',
   array['data loss','not saved','out of sync','stale','duplicate record','corrupt']),
  ('UI / Layout', 'minor',
   E'Screen / viewport:\n- \n\nSteps:\n1. \n2. \n\nExpected:\n- \n\nActual (attach screenshot):\n- ',
   array['alignment','overflow','spacing','responsive','css','z-index','tooltip','truncated']),
  ('Performance', 'major',
   E'Environment:\n- \n\nSteps:\n1. \n2. Measure <metric>\n\nExpected: < N ms / s\nActual: ',
   array['slow','timeout','lag','hangs','memory leak','high cpu','freeze']),
  ('Crash / Error', 'critical',
   E'Steps:\n1. \n2. \n\nStack trace / console error:\n```\n\n```\n\nExpected:\n- No error\nActual:\n- ',
   array['crash','exception','500','stack trace','white screen','unhandled','fatal']),
  ('Content / Copy', 'trivial',
   E'Location:\n- \n\nCurrent text:\n- \n\nSuggested text:\n- ',
   array['typo','grammar','wording','label','placeholder','copy'])
on conflict (name) do nothing;
