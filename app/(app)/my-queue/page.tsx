import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Badge, EmptyState, cx } from "@/components/ui";
import { SEVERITY_LABELS } from "@/lib/severity";
import { fmtDateTime, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MyQueuePage() {
  const { userId } = await requireProfile();
  const supabase = await createClient();

  const [{ data: bugs }, { data: tasks }] = await Promise.all([
    supabase
      .from("bugs")
      .select("id, title, severity, priority, status, due_date, project_id, projects(name)")
      .eq("assignee_id", userId)
      .not("status", "in", "(closed)")
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("tasks")
      .select("id, title, status, priority, due_date, project_id, projects(name)")
      .eq("assignee_id", userId)
      .neq("status", "done")
      .order("due_date", { ascending: true, nullsFirst: false }),
  ]);

  return (
    <div>
      <PageHeader
        title="My Queue"
        subtitle="Everything assigned to you across projects, most urgent first."
      />

      <h2 className="mb-2 text-sm font-semibold text-slate-700">
        Bugs ({bugs?.length ?? 0})
      </h2>
      {bugs && bugs.length > 0 ? (
        <div className="sheet-wrap mb-8 rounded-sm border border-grid-line">
          <table className="sheet">
            <thead>
              <tr>
                <th className="rownum">#</th>
                <th className="freeze min-w-[14rem]">Bug</th>
                <th>Project</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {bugs.map((b, i) => {
                const late = b.due_date && Date.parse(b.due_date) < Date.now();
                return (
                  <tr key={b.id}>
                    <td className="rownum">{i + 1}</td>
                    <td className="freeze">
                      <Link
                        href={`/projects/${b.project_id}/bugs?focus=${b.id}`}
                        className="font-medium text-slate-800 hover:text-brand-fg"
                      >
                        {b.title}
                      </Link>
                    </td>
                    <td className="text-slate-500">{b.projects?.name}</td>
                    <td>
                      <Badge
                        tone={
                          b.severity === "critical"
                            ? "red"
                            : b.severity === "major"
                              ? "amber"
                              : "slate"
                        }
                      >
                        {SEVERITY_LABELS[b.severity]}
                      </Badge>
                    </td>
                    <td className="text-slate-600">{titleCase(b.status)}</td>
                    <td
                      className={cx(
                        "whitespace-nowrap text-xs",
                        late ? "font-semibold text-red-700" : "text-slate-500",
                      )}
                    >
                      {b.due_date ? fmtDateTime(b.due_date) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mb-8">
          <EmptyState title="No bugs assigned to you" />
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold text-slate-700">
        Tasks ({tasks?.length ?? 0})
      </h2>
      {tasks && tasks.length > 0 ? (
        <Card className="divide-y divide-slate-100">
          {tasks.map((t) => {
            const overdue =
              t.due_date && Date.parse(t.due_date) < Date.now();
            return (
              <Link
                key={t.id}
                href={`/projects/${t.project_id}/tasks?focus=${t.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-slate-50"
              >
                <div>
                  <p className="font-medium text-slate-800">{t.title}</p>
                  <p className="text-xs text-slate-500">
                    {t.projects?.name} · {titleCase(t.status)}
                  </p>
                </div>
                <span
                  className={cx(
                    "shrink-0 text-xs",
                    overdue ? "font-semibold text-red-700" : "text-slate-500",
                  )}
                >
                  {t.due_date ? `Due ${fmtDateTime(t.due_date)}` : "No due date"}
                </span>
              </Link>
            );
          })}
        </Card>
      ) : (
        <EmptyState title="No tasks assigned to you" />
      )}
    </div>
  );
}
