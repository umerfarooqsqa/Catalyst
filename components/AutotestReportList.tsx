import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import type { ReportSummary } from "@/lib/autotest-report";

export type ReportListRow = {
  id: string;
  version: string | null;
  run_id: string;
  status: string;
  created_at: string;
  runner: string | null;
  summary: ReportSummary;
};

/** The project's auto-test reports (migration 0039), newest first, on its Automation tab. */
export default function AutotestReportList({ projectId, reports }: { projectId: string; reports: ReportListRow[] }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-slate-700">🤖 Auto-test reports</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        A whole-app test run by Claude Code on the runner PC, started with one click in the aktrade Development
        Portal (&quot;Auto-test this app&quot;). It learns from every app&apos;s knowledge, past bugs and this
        project&apos;s client requirements. Findings become bugs only when someone files them from the report.
      </p>
      {reports.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No auto-test report for this project yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-grid-line text-left text-xs text-slate-500">
                <th className="px-2 py-1.5 font-medium">When</th>
                <th className="px-2 py-1.5 font-medium">Version</th>
                <th className="px-2 py-1.5 font-medium">Tests</th>
                <th className="px-2 py-1.5 font-medium">Requirements</th>
                <th className="px-2 py-1.5 font-medium">Past bugs found here</th>
                <th className="px-2 py-1.5 font-medium">Findings</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const t = r.summary?.tests ?? {};
                const rq = r.summary?.requirements ?? {};
                const failed = (t.failed ?? 0) + (t.broken ?? 0);
                return (
                  <tr key={r.id} className="border-b border-grid-line/60">
                    <td className="px-2 py-1.5 text-slate-600" suppressHydrationWarning>
                      {fmtDateTime(r.created_at)}
                      {r.status === "partial" && (
                        <Badge tone="amber" className="ml-1.5">
                          partial
                        </Badge>
                      )}
                    </td>
                    <td className="px-2 py-1.5">{r.version ? `v${r.version}` : "—"}</td>
                    <td className="px-2 py-1.5">
                      <span className={failed ? "text-red-700" : "text-brand-fg"}>
                        {t.passed ?? 0}/{t.total ?? 0} passed
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      {rq.total ? (
                        <span className={rq.failed ? "text-red-700" : ""}>
                          {rq.passed ?? 0}/{rq.total} passed{rq.failed ? `, ${rq.failed} failed` : ""}
                        </span>
                      ) : (
                        <span className="text-slate-400">none</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">{r.summary?.past_bugs?.present ?? 0}</td>
                    <td className="px-2 py-1.5">{r.summary?.findings?.total ?? 0}</td>
                    <td className="px-2 py-1.5 text-right">
                      <Link
                        href={`/projects/${projectId}/automation/reports/${r.id}`}
                        className="text-xs font-medium text-brand hover:underline"
                      >
                        Open report →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
