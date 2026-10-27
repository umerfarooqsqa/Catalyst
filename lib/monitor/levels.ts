/**
 * How an open app warning is filed in My Queue (2026-10-27, asked by the user): three levels
 * instead of one red list. Worked out here from what the monitor already stores, so no
 * migration and no change to who is notified (still critical only, migration 0060):
 *  - critical: Google's own red line, still true at the last check (policy, rejected or
 *    untested release, over a vitals limit, a serious Play email, "checks have stopped");
 *  - not_critical: amber, still true (close to a limit, a deadline coming, a halted rollout,
 *    missing release notes, Google's spike detection, other Play emails);
 *  - negligible: nothing to act on now: the condition has cleared by itself (the card waits
 *    for someone to close it), or it is a note about the checker rather than the app (no
 *    access, Reporting API off, a release name it couldn't read).
 */
import { androidName } from "@/lib/monitor/rules";

export type WarningLevel = "critical" | "not_critical" | "negligible";

export const LEVELS: { key: WarningLevel; label: string; hint: string }[] = [
  { key: "critical", label: "Critical", hint: "Over Google's line now: act on these" },
  { key: "not_critical", label: "Not critical", hint: "Getting close, or worth a look" },
  { key: "negligible", label: "Negligible", hint: "Already cleared, or a note about the checker itself" },
];

const CHECKER_KINDS = new Set(["release_name", "reporting_api_disabled"]);

export function warningLevel(w: { severity: string; active: boolean; source: string; kind: string }): WarningLevel {
  if (!w.active) return "negligible";
  // monitor_play / monitor_vitals: the checker's own problems; monitor_stale_*: the app isn't watched any more
  if (w.source.startsWith("monitor") && !w.source.startsWith("monitor_stale")) return "negligible";
  if (CHECKER_KINDS.has(w.kind)) return "negligible";
  return w.severity === "critical" ? "critical" : "not_critical";
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
