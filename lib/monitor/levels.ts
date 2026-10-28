/**
 * How an open app warning is filed in My Queue (2026-10-27, asked by the user), and since
 * 2026-10-28 (the user's list, migration 0062) which ones are emailed:
 *  - critical: only these five kinds of problem, red and still true at the last check. They are
 *    the only warnings that ring the bell and are emailed (app_warning_is_critical in SQL, the
 *    same list; keep the two in step):
 *      A. Play policy / suspension: the app is suspended, or a serious Play Console email;
 *      B. target API compliance: Play rejects updates / hides the app on newer Android;
 *      C. crash or ANR rate over Google's limit, overall or on a phone model;
 *      D. a new crash or ANR in the live build, hitting enough users;
 *      F. critical bugs still open on the live version (portal);
 *  - not_critical: everything else that is still true: amber warnings, and other red ones
 *    (untested live build, version mismatch, rejected or halted release, wake locks, "checks
 *    have stopped");
 *  - negligible: nothing to act on now: the condition has cleared by itself (the card waits
 *    for someone to close it), or it is a note about the checker rather than the app (no
 *    access, Reporting API off, a release name it couldn't read).
 */
import { androidName } from "@/lib/monitor/rules";

export type WarningLevel = "critical" | "not_critical" | "negligible";

export const LEVELS: { key: WarningLevel; label: string; hint: string }[] = [
  { key: "critical", label: "Critical", hint: "Suspension or Play policy, target API, crash/ANR over Google's limit, new crashes in the live build, critical bugs on the live version. Only these are emailed." },
  { key: "not_critical", label: "Not critical", hint: "Getting close, or worth a look. Not emailed." },
  { key: "negligible", label: "Negligible", hint: "Already cleared, or a note about the checker itself. Not emailed." },
];

/** The kinds that make up the Critical section (A-F above); SQL: app_warning_is_critical (0062). */
export const CRITICAL_KINDS = new Set([
  "app_suspended", "play_email", // A
  "target_api", // B
  "crash_rate", "anr_rate", "crash_rate_device", "anr_rate_device", // C
  "new_crash", // D
  "critical_bugs_live", // F
]);

export const isCriticalKind = (kind: string, severity: string) => severity === "critical" && CRITICAL_KINDS.has(kind);

const CHECKER_KINDS = new Set(["release_name", "reporting_api_disabled"]);

export function warningLevel(w: { severity: string; active: boolean; source: string; kind: string }): WarningLevel {
  if (!w.active) return "negligible";
  // monitor_play / monitor_vitals: the checker's own problems; monitor_stale_*: the app isn't watched any more
  if (w.source.startsWith("monitor") && !w.source.startsWith("monitor_stale")) return "negligible";
  if (CHECKER_KINDS.has(w.kind)) return "negligible";
  return isCriticalKind(w.kind, w.severity) ? "critical" : "not_critical";
}

/** Labels for the facts a warning stores in app_warnings.data (lib/monitor/rules.ts, run.ts). */
const DATA_LABELS: Record<string, string> = {
  version: "Version",
  play_version: "Version on Play",
  play_code: "Build (version code)",
  tested: "Version QA is testing",
  status: "Release status",
  fraction: "Rollout",
  target: "Target SDK",
  required: "Required target SDK",
  since: "Rule in force since",
  from: "Deadline",
  extended_to: "Extended to",
  rate: "Rate",
  limit: "Google's limit",
  count: "Count",
  date: "Email date",
  from_address: "From",
};

const pct = (x: number) => `${(x * 100).toFixed(x < 0.001 ? 3 : 2)}%`;

/** The warning's stored facts as label/value rows, in a readable form. Unknown keys are kept. */
export function warningFacts(data: unknown): { label: string; value: string }[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const rows: { label: string; value: string }[] = [];
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (v === null || v === undefined || v === "") continue;
    // a mail's sender is stored as "from", which elsewhere means a deadline date
    const key = k === "from" && typeof v === "string" && v.includes("@") ? "from_address" : k;
    let value: string;
    if ((key === "rate" || key === "limit" || key === "fraction") && typeof v === "number") value = pct(v);
    else if ((key === "target" || key === "required") && typeof v === "number") value = androidName(v);
    else if (typeof v === "object") value = JSON.stringify(v);
    else value = String(v);
    rows.push({ label: DATA_LABELS[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), value });
  }
  return rows;
}
