import { createClient } from "@/lib/supabase/server";
import { getProjects } from "@/lib/auth";
import { PageHeader, Badge, Select, Button } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import {
  AUDIT_LOG_ENTITY_TYPES,
  AUDIT_LOG_ENTITY_LABELS,
  AUDIT_LOG_ACTIONS,
  AUDIT_LOG_ACTION_LABELS,
  type AuditLogEntityType,
  type AuditLogAction,
} from "@/lib/types/models";

export const dynamic = "force-dynamic";

const ROW_LIMIT = 200;

type AuditRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  project_id: string | null;
  summary: string | null;
  changes: unknown;
  created_at: string;
  actor: { full_name: string } | null;
};

const ACTION_TONE: Record<string, "green" | "blue" | "red"> = {
  insert: "green",
  update: "blue",
  delete: "red",
};

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    entity?: string;
    action?: string;
    project?: string;
  }>;
}) {
  const { entity, action, project } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("audit_log")
    .select(
      "id, action, entity_type, entity_id, entity_label, project_id, summary, changes, created_at, actor:profiles(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);

  if (entity) query = query.eq("entity_type", entity);
  if (action) query = query.eq("action", action);
  if (project) query = query.eq("project_id", project);

  const [{ data: rows }, projects] = await Promise.all([
    query,
    getProjects(),
  ]);

  const projectName = (id: string | null) =>
    id ? (projects.find((p) => p.id === id)?.name ?? id) : null;

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle={`Portal-wide activity trail — every create/update/delete across bugs, tasks, requirements, test cases, projects, comments, attachments, the master library, and users. Showing the latest ${ROW_LIMIT}.`}
      />

      <form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-grid-line bg-white p-3"
      >
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-500">
            Entity
          </label>
          <Select name="entity" defaultValue={entity ?? ""} className="min-w-[10rem]">
            <option value="">All entities</option>
            {AUDIT_LOG_ENTITY_TYPES.map((t: AuditLogEntityType) => (
              <option key={t} value={t}>
                {AUDIT_LOG_ENTITY_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-500">
            Action
          </label>
          <Select name="action" defaultValue={action ?? ""} className="min-w-[8rem]">
            <option value="">All actions</option>
            {AUDIT_LOG_ACTIONS.map((a: AuditLogAction) => (
              <option key={a} value={a}>
                {AUDIT_LOG_ACTION_LABELS[a]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-500">
            Project
          </label>
          <Select name="project" defaultValue={project ?? ""} className="min-w-[12rem]">
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        {(entity || action || project) && (
          <a
            href="/admin/audit-log"
            className="text-xs text-slate-400 hover:text-brand-fg"
          >
            Clear filters
          </a>
        )}
      </form>

      {/* Phones: one line per event (the seven table columns don't fit) */}
      <ul className="divide-y divide-grid-line rounded-md border border-grid-line bg-white sm:hidden">
        {((rows as AuditRow[] | null) ?? []).map((r) => (
          <li key={r.id} className="px-3 py-2.5 text-[13px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={ACTION_TONE[r.action] ?? "slate"}>
                {AUDIT_LOG_ACTION_LABELS[r.action as AuditLogAction] ?? r.action}
              </Badge>
              <span className="text-slate-700">
                {AUDIT_LOG_ENTITY_LABELS[r.entity_type as AuditLogEntityType] ?? r.entity_type}
              </span>
              <span className="ml-auto text-xs text-slate-400" suppressHydrationWarning>
                {fmtDateTime(r.created_at)}
              </span>
            </div>
            <p className="mt-1 break-words text-slate-800">
              <span className="font-medium">{r.entity_label ?? r.entity_id}</span>
              {r.summary && r.summary !== "created" && r.summary !== "deleted" ? (
                <span className="text-slate-500"> — {r.summary}</span>
              ) : null}
            </p>
            <p className="text-xs text-slate-500">
              {r.actor?.full_name ?? "System"}
              {projectName(r.project_id) ? ` · ${projectName(r.project_id)}` : ""}
            </p>
            {r.changes ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-slate-400">diff</summary>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-sm bg-grid-head/60 p-2 text-[11px] text-slate-600">
                  {JSON.stringify(r.changes, null, 2)}
                </pre>
              </details>
            ) : null}
          </li>
        ))}
        {(!rows || rows.length === 0) && (
          <li className="py-8 text-center text-slate-400">No activity matches these filters yet.</li>
        )}
      </ul>

      <div className="sheet-wrap hidden rounded-sm border border-grid-line sm:block">
        <table className="sheet">
          <thead>
            <tr>
              <th className="min-w-[9rem]">Time</th>
              <th className="min-w-[8rem]">Actor</th>
              <th className="min-w-[6rem]">Action</th>
              <th className="min-w-[8rem]">Entity</th>
              <th className="min-w-[10rem]">Project</th>
              <th className="min-w-[16rem]">Summary</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {((rows as AuditRow[] | null) ?? []).map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap text-slate-500">
                  <span suppressHydrationWarning>{fmtDateTime(r.created_at)}</span>
                </td>
                <td className="text-slate-700">{r.actor?.full_name ?? "System"}</td>
                <td>
                  <Badge tone={ACTION_TONE[r.action] ?? "slate"}>
                    {AUDIT_LOG_ACTION_LABELS[r.action as AuditLogAction] ?? r.action}
                  </Badge>
                </td>
                <td className="text-slate-700">
                  {AUDIT_LOG_ENTITY_LABELS[r.entity_type as AuditLogEntityType] ??
                    r.entity_type}
                </td>
                <td className="text-slate-500">
                  {projectName(r.project_id) ?? "—"}
                </td>
                <td className="text-slate-700">
                  <span className="font-medium">{r.entity_label ?? r.entity_id}</span>
                  {r.summary && r.summary !== "created" && r.summary !== "deleted" ? (
                    <span className="text-slate-500"> — {r.summary}</span>
                  ) : null}
                </td>
                <td>
                  {r.changes ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-slate-400 hover:text-brand-fg">
                        diff
                      </summary>
                      <pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap rounded-sm bg-grid-head/60 p-2 text-[11px] text-slate-600">
                        {JSON.stringify(r.changes, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </td>
              </tr>
            ))}
            {(!rows || rows.length === 0) && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  No activity matches these filters yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
