import Link from "next/link";
import VersionChip from "@/components/VersionChip";
import AreaChip from "@/components/AreaChip";
import type { ReactNode } from "react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Badge, EmptyState, cx } from "@/components/ui";
import { SEVERITY_LABELS } from "@/lib/severity";
import { fmtDate, fmtDateTime, titleCase } from "@/lib/format";
import { BugQueueActions, TaskQueueActions, DelegateSelect, VerifyFixActions } from "@/components/QueueActions";
import type { JuniorOption } from "@/components/QueueActions";
import { isAdmin, isLeadDeveloper } from "@/lib/permissions";

export const dynamic = "force-dynamic";

type Tone = "slate" | "blue" | "green" | "amber" | "red" | "violet";

const STATUS_TONE: Record<string, Tone> = {
  open: "blue",
  reopened: "red",
  in_progress: "amber",
  fixed: "green",
  ready_for_retest: "violet",
  todo: "blue",
  blocked: "red",
  pending_approval: "violet",
};
const SEVERITY_TONE: Record<string, Tone> = { critical: "red", major: "amber" };
const PRIORITY_TONE: Record<string, Tone> = { high: "red", medium: "slate", low: "slate" };

function DueChip({ due }: { due: string | null }) {
  if (!due) return <span className="text-[11px] text-slate-400">No due date</span>;
  const late = Date.parse(due) < Date.now();
  return (
    <span
      className={cx(
        "whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
        late ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600",
      )}
      suppressHydrationWarning
    >
      {late ? "Overdue · " : "Due "}
      {fmtDate(due)}
    </span>
  );
}

/** One item of the queue as a card: badges and due date, title, project, then the actions. */
function QueueCard({
  badges,
  due,
  href,
  title,
  project,
  actions,
}: {
  badges: ReactNode;
  due: string | null;
  href: string;
  title: string;
  project?: string | null;
  actions: ReactNode;
}) {
  return (
    <li className="flex flex-col rounded-md border border-grid-line bg-white p-3 shadow-card">
      <div className="flex flex-wrap items-center gap-1.5">
        {badges}
        <span className="ml-auto">
          <DueChip due={due} />
        </span>
      </div>
      <Link href={href} className="mt-2 line-clamp-3 font-medium leading-snug text-slate-800 hover:text-brand-fg">
        {title}
      </Link>
      {project ? <p className="mt-1 truncate text-xs text-slate-500">{project}</p> : null}
      {/* pushes the actions to the bottom, so cards in one grid row line up */}
      <div className="flex-1" />
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-grid-line pt-2.5">
        {actions}
        <Link href={href} className="ml-auto text-xs font-medium text-brand-fg hover:underline">
          Open ↗
        </Link>
      </div>
    </li>
  );
}

const BUG_FIELDS =
  "id, title, severity, area, priority, status, due_date, project_id, assignee_id, projects(name, platform), version_confirmed_at, release:releases(version), delegator:profiles!bugs_delegated_by_fkey(full_name), assignee:profiles!bugs_assignee_id_fkey(full_name)";
const TASK_FIELDS =
  "id, title, status, priority, due_date, project_id, assignee_id, projects(name, platform), delegator:profiles!tasks_delegated_by_fkey(full_name), assignee:profiles!tasks_assignee_id_fkey(full_name)";

export default async function MyQueuePage() {
  const { userId, level, profile } = await requireProfile();
  const supabase = await createClient();
  // A lead developer hands their own bugs and tasks to junior developers (migration 0040).
  const lead = isLeadDeveloper(level, profile.dev_rank);

  const [{ data: bugs }, { data: tasks }, { data: handedBugs }, { data: handedTasks }, { data: juniorRows }] =
    await Promise.all([
      supabase
        .from("bugs")
        .select(BUG_FIELDS)
        .eq("assignee_id", userId)
        .not("status", "in", "(closed)")
        .order("due_date", { ascending: true, nullsFirst: false }),
      supabase
        .from("tasks")
        .select(TASK_FIELDS)
        .eq("assignee_id", userId)
        .neq("status", "done")
        .order("due_date", { ascending: true, nullsFirst: false }),
      lead
        ? supabase
            .from("bugs")
            .select(BUG_FIELDS)
            .eq("delegated_by", userId)
            .not("status", "in", "(closed)")
            .order("due_date", { ascending: true, nullsFirst: false })
        : Promise.resolve({ data: null }),
      lead
        ? supabase
            .from("tasks")
            .select(TASK_FIELDS)
            .eq("delegated_by", userId)
            .neq("status", "done")
            .order("due_date", { ascending: true, nullsFirst: false })
        : Promise.resolve({ data: null }),
      lead
        ? supabase
            .from("profiles")
            .select("id, full_name, roles(level, platform)")
            .eq("dev_rank", "junior")
            .order("full_name")
        : Promise.resolve({ data: null }),
    ]);

  // Juniors who can see a project: the same platform rule as the database's can_see_project.
  const juniors = ((juniorRows ?? []) as unknown as {
    id: string;
    full_name: string;
    roles: { level: string; platform: string | null } | null;
  }[]).filter((j) => j.roles?.level === "contributor");
  const juniorsFor = (platform: string | null | undefined): JuniorOption[] =>
    juniors
      .filter((j) => !j.roles?.platform || j.roles.platform === platform)
      .map((j) => ({ id: j.id, full_name: j.full_name }));
  const handedOnCount = (handedBugs?.length ?? 0) + (handedTasks?.length ?? 0);

  // Admins: every bug a developer marked fixed (or QA set ready for retest), across all
  // projects, oldest first, until an admin closes or reopens it. Who marked it fixed and
  // when comes from the audit log (admin-only, migration 0020).
  const admin = isAdmin(level);
  const { data: fixedBugs } = admin
    ? await supabase
        .from("bugs")
        .select(BUG_FIELDS)
        .in("status", ["fixed", "ready_for_retest"])
        .order("updated_at", { ascending: true })
        .limit(200)
    : { data: null };
  const markedFixed = new Map<string, { by: string | null; at: string }>();
  if (fixedBugs?.length) {
    const { data: marks } = await supabase
      .from("audit_log")
      .select("entity_id, actor_id, created_at")
      .eq("entity_type", "bugs")
      .eq("action", "update")
      .eq("changes->status->>to", "fixed")
      .in("entity_id", fixedBugs.map((b) => b.id))
      .order("created_at", { ascending: false });
    const actorIds = [...new Set((marks ?? []).map((m) => m.actor_id).filter((x): x is string => !!x))];
    const { data: actors } = actorIds.length
      ? await supabase.from("profiles").select("id, full_name").in("id", actorIds)
      : { data: [] };
    const nameOf = new Map((actors ?? []).map((a) => [a.id, a.full_name]));
    for (const m of marks ?? []) {
      if (!markedFixed.has(m.entity_id))
        markedFixed.set(m.entity_id, { by: m.actor_id ? (nameOf.get(m.actor_id) ?? null) : null, at: m.created_at });
    }
  }

  return (
    <div>
      <PageHeader
        title="My Queue"
        subtitle={
          admin
            ? "Bugs developers marked fixed, waiting for you to verify, then everything assigned to you across projects."
            : lead
            ? "Everything assigned to you across projects, most urgent first. Hand bugs and tasks to a junior developer, and follow what you handed on below."
            : "Everything assigned to you across projects, most urgent first. Mark bugs fixed and tasks done right here."
        }
      />

      {admin ? (
        <>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Fixed: waiting for you to verify ({fixedBugs?.length ?? 0})
          </h2>
          {fixedBugs && fixedBugs.length > 0 ? (
            <ul className="mb-8 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {fixedBugs.map((b) => {
                const mark = markedFixed.get(b.id);
                const who = mark?.by ?? b.assignee?.full_name ?? null;
                return (
                  <QueueCard
                    key={b.id}
                    href={`/projects/${b.project_id}/bugs?focus=${b.id}`}
                    title={b.title}
                    project={[
                      b.projects?.name,
                      who || mark ? `marked fixed${who ? ` by ${who}` : ""}${mark ? `, ${fmtDateTime(mark.at)}` : ""}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    due={b.due_date}
                    badges={
                      <>
                        <Badge tone={STATUS_TONE[b.status] ?? "slate"}>{titleCase(b.status)}</Badge>
                        <Badge tone={SEVERITY_TONE[b.severity] ?? "slate"}>{SEVERITY_LABELS[b.severity]}</Badge>
                        <AreaChip area={b.area} />
                        <VersionChip version={b.release?.version} confirmedAt={b.version_confirmed_at} showMissing />
                      </>
                    }
                    actions={<VerifyFixActions bugId={b.id} />}
                  />
                );
              })}
            </ul>
          ) : (
            <div className="mb-8">
              <EmptyState title="No fixed bugs waiting for you" />
            </div>
          )}
        </>
      ) : null}

      <h2 className="mb-2 text-sm font-semibold text-slate-700">Bugs ({bugs?.length ?? 0})</h2>
      {bugs && bugs.length > 0 ? (
        <ul className="mb-8 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {bugs.map((b) => (
            <QueueCard
              key={b.id}
              href={`/projects/${b.project_id}/bugs?focus=${b.id}`}
              title={b.title}
              project={b.projects?.name}
              due={b.due_date}
              badges={
                <>
                  <Badge tone={SEVERITY_TONE[b.severity] ?? "slate"}>{SEVERITY_LABELS[b.severity]}</Badge>
                  <AreaChip area={b.area} />
                  <Badge tone={STATUS_TONE[b.status] ?? "slate"}>{titleCase(b.status)}</Badge>
                  <VersionChip version={b.release?.version} confirmedAt={b.version_confirmed_at} showMissing />
                  {b.delegator ? <Badge tone="slate">from {b.delegator.full_name}</Badge> : null}
                </>
              }
              actions={
                <>
                  <BugQueueActions bugId={b.id} status={b.status} />
                  {lead ? (
                    <DelegateSelect
                      table="bugs"
                      id={b.id}
                      juniors={juniorsFor(b.projects?.platform)}
                      selfId={userId}
                      assigneeId={b.assignee_id}
                    />
                  ) : null}
                </>
              }
            />
          ))}
        </ul>
      ) : (
        <div className="mb-8">
          <EmptyState title="No bugs assigned to you" />
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold text-slate-700">Tasks ({tasks?.length ?? 0})</h2>
      {tasks && tasks.length > 0 ? (
        <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {tasks.map((t) => (
            <QueueCard
              key={t.id}
              href={`/projects/${t.project_id}/tasks?focus=${t.id}`}
              title={t.title}
              project={t.projects?.name}
              due={t.due_date}
              badges={
                <>
                  <Badge tone={STATUS_TONE[t.status] ?? "slate"}>{titleCase(t.status)}</Badge>
                  {t.priority ? (
                    <Badge tone={PRIORITY_TONE[t.priority] ?? "slate"}>{titleCase(t.priority)} priority</Badge>
                  ) : null}
                  {t.delegator ? <Badge tone="slate">from {t.delegator.full_name}</Badge> : null}
                </>
              }
              actions={
                <>
                  <TaskQueueActions taskId={t.id} status={t.status} role={level} />
                  {lead ? (
                    <DelegateSelect
                      table="tasks"
                      id={t.id}
                      juniors={juniorsFor(t.projects?.platform)}
                      selfId={userId}
                      assigneeId={t.assignee_id}
                    />
                  ) : null}
                </>
              }
            />
          ))}
        </ul>
      ) : (
        <EmptyState title="No tasks assigned to you" />
      )}

      {lead ? (
        <>
          <h2 className="mb-2 mt-8 text-sm font-semibold text-slate-700">
            Handed to junior developers ({handedOnCount})
          </h2>
          {handedOnCount > 0 ? (
            <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {(handedBugs ?? []).map((b) => (
                <QueueCard
                  key={b.id}
                  href={`/projects/${b.project_id}/bugs?focus=${b.id}`}
                  title={b.title}
                  project={b.projects?.name}
                  due={b.due_date}
                  badges={
                    <>
                      <Badge tone="slate">Bug</Badge>
                      <AreaChip area={b.area} />
                      <Badge tone={STATUS_TONE[b.status] ?? "slate"}>{titleCase(b.status)}</Badge>
                      <Badge tone="violet">with {b.assignee?.full_name ?? "nobody"}</Badge>
                    </>
                  }
                  actions={
                    <DelegateSelect
                      table="bugs"
                      id={b.id}
                      juniors={juniorsFor(b.projects?.platform)}
                      selfId={userId}
                      assigneeId={b.assignee_id}
                    />
                  }
                />
              ))}
              {(handedTasks ?? []).map((t) => (
                <QueueCard
                  key={t.id}
                  href={`/projects/${t.project_id}/tasks?focus=${t.id}`}
                  title={t.title}
                  project={t.projects?.name}
                  due={t.due_date}
                  badges={
                    <>
                      <Badge tone="slate">Task</Badge>
                      <Badge tone={STATUS_TONE[t.status] ?? "slate"}>{titleCase(t.status)}</Badge>
                      <Badge tone="violet">with {t.assignee?.full_name ?? "nobody"}</Badge>
                    </>
                  }
                  actions={
                    <DelegateSelect
                      table="tasks"
                      id={t.id}
                      juniors={juniorsFor(t.projects?.platform)}
                      selfId={userId}
                      assigneeId={t.assignee_id}
                    />
                  }
                />
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing handed on" />
          )}
        </>
      ) : null}
    </div>
  );
}
