import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, Stat, Badge, EmptyState } from "@/components/ui";
import { SEVERITY_LABELS } from "@/lib/severity";
import { fmtDateTime, fmtRelative, titleCase } from "@/lib/format";
import { isViewer } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { userId, profile, level } = await requireProfile();
  const supabase = await createClient();

  const [{ data: myBugs }, { data: myTasks }, { data: recent }] =
    await Promise.all([
      supabase
        .from("bugs")
        .select("id, title, severity, status, due_date, project_id, projects(name)")
        .eq("assignee_id", userId)
        .not("status", "in", "(closed)")
        .order("due_date", { ascending: true, nullsFirst: false }),
      supabase
        .from("tasks")
        .select("id, title, status, priority, due_date, project_id, projects(name)")
        .eq("assignee_id", userId)
        .neq("status", "done")
        .order("due_date", { ascending: true, nullsFirst: false }),
      supabase
        .from("bugs")
        .select("id, title, status, updated_at, project_id, projects(name)")
        .order("updated_at", { ascending: false })
        .limit(8),
    ]);

  const now = Date.now();
  const overdue = [
    ...(myBugs ?? []),
    ...(myTasks ?? []),
  ].filter((r) => r.due_date && Date.parse(r.due_date) < now).length;

  return (
    <div>
      <PageHeader
        title={`Welcome, ${profile.full_name.split(" ")[0]}`}
        subtitle={
          isViewer(level)
            ? "Read-only access. Browse projects, bugs, and traceability."
            : "Your queue and recent activity."
        }
      />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="My open bugs" value={myBugs?.length ?? 0} />
        <Stat label="My open tasks" value={myTasks?.length ?? 0} />
        <Stat
          label="Overdue"
          value={overdue}
          tone={overdue ? "red" : undefined}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            My queue — bugs
          </h2>
          {myBugs && myBugs.length > 0 ? (
            <Card className="divide-y divide-slate-100">
              {myBugs.slice(0, 8).map((b) => {
                const late = b.due_date && Date.parse(b.due_date) < now;
                return (
                  <Link
                    key={b.id}
                    href={`/projects/${b.project_id}/bugs?focus=${b.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">
                        {b.title}
                      </p>
                      <p className="text-xs text-slate-500">
                        {b.projects?.name} · {titleCase(b.status)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
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
                      {b.due_date && (
                        <span
                          className={
                            late
                              ? "text-xs font-semibold text-red-700"
                              : "text-xs text-slate-500"
                          }
                        >
                          {fmtDateTime(b.due_date)}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </Card>
          ) : (
            <EmptyState title="No bugs assigned to you" />
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            My queue — tasks
          </h2>
          {myTasks && myTasks.length > 0 ? (
            <Card className="divide-y divide-slate-100">
              {myTasks.slice(0, 8).map((t) => (
                <Link
                  key={t.id}
                  href={`/projects/${t.project_id}/tasks?focus=${t.id}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">
                      {t.title}
                    </p>
                    <p className="text-xs text-slate-500">
                      {t.projects?.name} · {titleCase(t.status)}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">
                    {t.due_date ? `Due ${fmtDateTime(t.due_date)}` : "No due date"}
                  </span>
                </Link>
              ))}
            </Card>
          ) : (
            <EmptyState title="No tasks assigned to you" />
          )}
        </section>

        <section className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Recent bug activity
          </h2>
          <Card className="divide-y divide-slate-100">
            {(recent ?? []).map((b) => (
              <Link
                key={b.id}
                href={`/projects/${b.project_id}/bugs?focus=${b.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-slate-50"
              >
                <span className="truncate text-slate-700">{b.title}</span>
                <span className="shrink-0 text-xs text-slate-400">
                  {titleCase(b.status)} · {fmtRelative(b.updated_at)}
                </span>
              </Link>
            ))}
          </Card>
        </section>
      </div>
    </div>
  );
}
