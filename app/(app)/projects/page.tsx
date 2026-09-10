import { Suspense } from "react";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { canManageProjects, canAdminister } from "@/lib/permissions";
import { fmtDate } from "@/lib/format";
import NewProjectForm from "./new-project-form";
import DeleteProjectButton from "@/components/DeleteProjectButton";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const { level } = await requireProfile();
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, description, created_at")
    .order("name");

  const { data: bugRows } = await supabase
    .from("bugs")
    .select("project_id, status");
  const counts = new Map<string, { open: number; total: number }>();
  for (const b of bugRows ?? []) {
    const c = counts.get(b.project_id) ?? { open: 0, total: 0 };
    c.total++;
    if (!["closed", "fixed"].includes(b.status)) c.open++;
    counts.set(b.project_id, c);
  }

  const canManage = canManageProjects(level);
  const canDelete = canAdminister(level);

  return (
    <div>
      <PageHeader title="Projects" subtitle="One row per app being tested." />

      {canManage && (
        <div className="mb-4">
          <Suspense>
            <NewProjectForm />
          </Suspense>
        </div>
      )}

      {!projects || projects.length === 0 ? (
        <EmptyState title="No projects yet">
          {canManage
            ? "Use “+ New project” above to add the first one."
            : "A QA or Admin user needs to create a project."}
        </EmptyState>
      ) : (
        <div className="sheet-wrap rounded-sm border border-grid-line">
          <table className="sheet">
            <thead>
              <tr>
                <th className="rownum">#</th>
                <th className="min-w-[10rem]">Project</th>
                <th className="min-w-[16rem]">Description</th>
                <th className="w-20 text-right">Open</th>
                <th className="w-20 text-right">Total</th>
                <th className="w-28">Created</th>
                {canDelete && <th className="w-56" />}
              </tr>
            </thead>
            <tbody>
              {projects.map((p, i) => {
                const c = counts.get(p.id) ?? { open: 0, total: 0 };
                return (
                  <tr key={p.id} className="group">
                    <td className="rownum">{i + 1}</td>
                    <td className="font-medium">
                      <Link
                        href={`/projects/${p.id}`}
                        className="text-brand-fg hover:underline"
                      >
                        {p.name}
                      </Link>
                    </td>
                    <td className="text-slate-500">
                      {p.description || "—"}
                    </td>
                    <td className="text-right tabular-nums">{c.open}</td>
                    <td className="text-right tabular-nums text-slate-500">
                      {c.total}
                    </td>
                    <td className="whitespace-nowrap text-xs text-slate-500">
                      {fmtDate(p.created_at)}
                    </td>
                    {canDelete && (
                      <td className="text-right">
                        <DeleteProjectButton
                          projectId={p.id}
                          projectName={p.name}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
