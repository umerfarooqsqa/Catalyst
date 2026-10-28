import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile, getUserPlatform } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, LinkButton } from "@/components/ui";
import { canManageProjects, canAdminister } from "@/lib/permissions";
import { fmtDate } from "@/lib/format";
import NewProjectForm from "./new-project-form";
import DeleteProjectButton from "@/components/DeleteProjectButton";
import { TRADECAST, seesMain, seesTradecast } from "@/lib/tradecast";

/**
 * The projects list. Tradecast is its own area (0064): /projects lists the Android/iOS (and
 * unset) projects, /tradecast lists Tradecast's, each with its own "+ New project". Someone who
 * can't see an area is sent to the one they can.
 */
export default async function ProjectsView({ area }: { area: "main" | "tradecast" }) {
  const [{ level }, userPlatform] = await Promise.all([requireProfile(), getUserPlatform()]);
  if (area === "main" && !seesMain(userPlatform)) redirect("/tradecast");
  if (area === "tradecast" && !seesTradecast(userPlatform)) redirect("/projects");
  const supabase = await createClient();

  let q = supabase.from("projects").select("id, name, description, created_at").order("name");
  q = area === "tradecast" ? q.eq("platform", TRADECAST) : q.or(`platform.is.null,platform.neq.${TRADECAST}`);
  const { data: projects } = await q;

  const { data: bugRows } = projects?.length
    ? await supabase
        .from("bugs")
        .select("project_id, status")
        .in("project_id", projects.map((p) => p.id))
    : { data: [] };
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
      <PageHeader
        title={area === "tradecast" ? "Tradecast projects" : "Projects"}
        subtitle={
          area === "tradecast"
            ? "Tradecast's own projects, kept apart from the Android and iOS apps. Its bugs go to the Tradecast Bug Library."
            : "One row per app being tested."
        }
        actions={
          canManage && area === "main" ? (
            <LinkButton href="/import/whatsapp" title="Import bugs and tasks from Grok's WhatsApp sheet">
              Import from WhatsApp
            </LinkButton>
          ) : undefined
        }
      />

      {canManage && (
        <div className="mb-4">
          <Suspense>
            <NewProjectForm platform={area === "tradecast" ? TRADECAST : undefined} />
          </Suspense>
        </div>
      )}

      {!projects || projects.length === 0 ? (
        <EmptyState title={area === "tradecast" ? "No Tradecast projects yet" : "No projects yet"}>
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
                <th className="hidden min-w-[16rem] sm:table-cell">Description</th>
                <th className="w-20 text-right">Open</th>
                <th className="w-20 text-right">Total</th>
                <th className="hidden w-28 sm:table-cell">Created</th>
                {canDelete && <th className="hidden w-56 sm:table-cell" />}
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
                    <td className="hidden text-slate-500 sm:table-cell">
                      {p.description || "—"}
                    </td>
                    <td className="text-right tabular-nums">{c.open}</td>
                    <td className="text-right tabular-nums text-slate-500">
                      {c.total}
                    </td>
                    <td className="hidden whitespace-nowrap text-xs text-slate-500 sm:table-cell">
                      {fmtDate(p.created_at)}
                    </td>
                    {canDelete && (
                      <td className="hidden text-right sm:table-cell">
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
