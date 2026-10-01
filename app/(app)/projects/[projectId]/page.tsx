import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Stat, Badge } from "@/components/ui";
import { SEVERITY_LABELS } from "@/lib/severity";
import { AREAS, AREA_SHORT } from "@/lib/bug-area";
import { titleCase, fmtRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProjectOverview({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const [{ data: bugs }, { data: tasks }, { data: reqs }, { data: recent }] =
    await Promise.all([
      supabase
        .from("bugs")
        .select("id, severity, area, status, due_date")
        .eq("project_id", projectId),
      supabase.from("tasks").select("id, status").eq("project_id", projectId),
      supabase
        .from("requirements")
        .select("id, status")
        .eq("project_id", projectId),
      supabase
        .from("bugs")
        .select("id, title, status, updated_at")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false })
        .limit(6),
    ]);

  const openBugs = (bugs ?? []).filter(
    (b) => !["closed", "fixed"].includes(b.status),
  );
  const overdue = openBugs.filter(
    (b) => b.due_date && Date.parse(b.due_date) < Date.now(),
  ).length;
  const bySeverity = (["critical", "major", "minor", "trivial"] as const).map(
    (s) => ({ s, n: openBugs.filter((b) => b.severity === s).length }),
  );
  // Open bugs by area (migrations 0041, 0042).
  const AREA_BAR = { frontend: "bg-sky-500", backend: "bg-violet-500", database: "bg-amber-500", devops: "bg-emerald-500" };
  const byArea = [
    ...AREAS.map((a) => ({ label: AREA_SHORT[a], n: openBugs.filter((b) => b.area === a).length, bar: `h-full ${AREA_BAR[a]}` })),
    { label: "Not set", n: openBugs.filter((b) => !b.area).length, bar: "h-full bg-slate-300" },
  ];
  const openTasks = (tasks ?? []).filter((t) => t.status !== "done").length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open bugs" value={openBugs.length} />
        <Stat
          label="Overdue"
          value={overdue}
          tone={overdue ? "red" : undefined}
        />
        <Stat label="Open tasks" value={openTasks} />
        <Stat label="Requirements" value={reqs?.length ?? 0} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Open bugs by severity
          </h2>
          <div className="space-y-2">
            {bySeverity.map(({ s, n }) => (
              <div key={s} className="flex items-center gap-3">
                <div className="w-16 text-xs text-slate-500">
                  {SEVERITY_LABELS[s]}
                </div>
                <div className="h-4 flex-1 overflow-hidden rounded-sm bg-grid-head">
                  <div
                    className={
                      s === "critical"
                        ? "h-full bg-red-500"
                        : s === "major"
                          ? "h-full bg-orange-400"
                          : s === "minor"
                            ? "h-full bg-yellow-400"
                            : "h-full bg-slate-400"
                    }
                    style={{
                      width: `${openBugs.length ? (n / openBugs.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="w-6 text-right text-xs font-medium text-slate-700">
                  {n}
                </div>
              </div>
            ))}
          </div>
          <h2 className="mb-3 mt-5 text-sm font-semibold text-slate-700">Open bugs by area</h2>
          <div className="space-y-2">
            {byArea.map(({ label, n, bar }) => (
              <div key={label} className="flex items-center gap-3">
                <div className="w-16 text-xs text-slate-500">{label}</div>
                <div className="h-4 flex-1 overflow-hidden rounded-sm bg-grid-head">
                  <div className={bar} style={{ width: `${openBugs.length ? (n / openBugs.length) * 100 : 0}%` }} />
                </div>
                <div className="w-6 text-right text-xs font-medium text-slate-700">{n}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Link
              href={`/projects/${projectId}/bugs`}
              className="text-sm text-brand hover:underline"
            >
              Open bug sheet →
            </Link>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Recent activity
          </h2>
          <div className="divide-y divide-grid-line">
            {(recent ?? []).map((b) => (
              <Link
                key={b.id}
                href={`/projects/${projectId}/bugs?focus=${b.id}`}
                className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-grid-head"
              >
                <span className="truncate text-slate-700">{b.title}</span>
                <span className="shrink-0 text-xs text-slate-400">
                  <Badge>{titleCase(b.status)}</Badge>{" "}
                  {fmtRelative(b.updated_at)}
                </span>
              </Link>
            ))}
            {(!recent || recent.length === 0) && (
              <p className="py-4 text-sm text-slate-400">No bugs yet.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
