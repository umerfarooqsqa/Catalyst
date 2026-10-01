/**
 * The shape of an auto-test report (automation_reports.report, migration 0039), as the
 * aktrade runner builds it (utils/autotest_report.py, schema 1). Every field is optional
 * on read: a report from an older runner may lack some.
 */
export type ReportTest = {
  nodeid: string;
  file: string;
  name: string;
  title: string;
  description?: string;
  severity?: string;
  status: "passed" | "failed" | "broken" | "skipped" | "xfailed" | string;
  duration?: number;
  error?: string;
  requirements?: string[];
  bugs?: string[];
  origin?: "auto" | "existing" | "shared" | string; // "approved" in reports from before 2026-09-30
  shot?: string | null;
  steps?: string[];
};

export type ReportRequirement = {
  id: string;
  full_id?: string | null;
  title: string;
  severity?: string;
  source?: "catalyst" | "draft" | string;
  document?: string | null;
  status: string; // passed | failed | skipped | not_testable | not_found | not_covered | not_run
  tests: string[];
  note?: string;
};

export type ReportPastBug = {
  id: string;
  title: string;
  severity?: string;
  open?: boolean;
  this_app?: boolean;
  apps?: string[];
  status: string; // present | not_present | skipped | not_testable | not_applicable | not_checked
  tests: string[];
  note?: string;
};

export type ReportFinding = {
  type: string; // app_bug | framework | coverage_gap | unexplained_failure
  title: string;
  detail?: string;
  test?: string;
  severity?: string;
  requirements?: string[];
  bugs?: string[];
  steps?: string[];
  error?: string;
  shot?: string | null;
  bug_id?: string;
  filed_at?: string;
};

export type ReportScreen = { name: string; activity?: string; reach?: string; ids?: string[]; notes?: string };

export type AutotestReportData = {
  schema?: number;
  run_id: string;
  house: string;
  app?: { name?: string; package?: string; version?: string; installed?: string };
  platform?: string;
  runner?: string;
  started?: string;
  finished?: string;
  status?: "complete" | "partial";
  partial_reason?: string;
  summary?: ReportSummary;
  learned_from?: {
    knowledge?: { common?: number; this_app?: number; other_apps?: Record<string, number> };
    screens?: { screens?: number; apps?: number };
    verified_tests?: number;
    recordings?: number;
    bugs?: { distinct?: number; this_app?: number; open?: number };
    requirements?: number;
  };
  context_errors?: string[];
  tests?: ReportTest[];
  requirements?: ReportRequirement[];
  past_bugs?: ReportPastBug[];
  findings?: ReportFinding[];
  screens?: ReportScreen[];
  learned?: { scope: string; text: string }[];
  claude_summary?: string;
  workbook_name?: string;
};

export type ReportSummary = {
  tests?: { total?: number; passed?: number; failed?: number; broken?: number; skipped?: number };
  files?: number;
  requirements?: { total?: number; passed?: number; failed?: number; not_testable?: number; not_found?: number; not_covered?: number };
  past_bugs?: { total?: number; present?: number; not_present?: number; not_checked?: number };
  findings?: { total?: number; app_bugs?: number; unexplained?: number };
  screens?: number;
  cost_usd?: number | null;
  budget_usd?: number | null;
};

export const RESULT_TONE: Record<string, "green" | "red" | "amber" | "slate" | "blue"> = {
  passed: "green",
  not_present: "green",
  failed: "red",
  broken: "red",
  present: "red",
  app_bug: "red",
  unexplained_failure: "red",
  skipped: "slate",
  xfailed: "slate",
  not_covered: "slate",
  not_checked: "slate",
  not_run: "slate",
  not_testable: "amber",
  not_found: "amber",
  not_applicable: "amber",
  framework: "amber",
  coverage_gap: "amber",
};

export const RESULT_LABEL: Record<string, string> = {
  passed: "Passed",
  failed: "Failed",
  broken: "Broken",
  skipped: "Skipped",
  xfailed: "Expected fail",
  present: "Bug found here",
  not_present: "Not present",
  not_covered: "Not covered",
  not_checked: "Not checked",
  not_run: "Not run",
  not_testable: "Not testable",
  not_found: "Not in app",
  not_applicable: "Not applicable",
  app_bug: "App bug",
  unexplained_failure: "Unexplained failure",
  framework: "Framework",
  coverage_gap: "Coverage gap",
};

export const label = (s: string) => RESULT_LABEL[s] ?? s.replace(/_/g, " ");
