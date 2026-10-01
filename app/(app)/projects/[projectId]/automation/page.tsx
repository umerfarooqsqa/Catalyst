import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { canSeeAutomation } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import ProjectAutomation from "@/components/ProjectAutomation";
import AutotestReportList, { type ReportListRow } from "@/components/AutotestReportList";

export const dynamic = "force-dynamic";

/**
 * A project's own automation: the folder on the runner machine it is linked to
 * (`projects/<platform>/<house>/` in the aktrade repo), what is in it, whether
 * its runner is online, and this project's jobs. Each project has its own
 * automation; the Android and iOS projects of one house are separate.
 */
export default async function ProjectAutomationPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { userId, level } = await requireProfile();
  if (!canSeeAutomation(level)) redirect(`/projects/${projectId}`);
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, platform, house_slug, house_group, current_version")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const [{ data: link }, { data: runners }, { data: jobs }, { data: bugs }, { data: reports }] = await Promise.all([
    supabase.from("project_automation").select("*").eq("project_id", projectId).maybeSingle(),
    project.platform
      ? supabase.from("automation_runners").select("*").eq("platform", project.platform).order("name")
      : Promise.resolve({ data: [] }),
    supabase
      .from("test_jobs")
      .select(
        "id, kind, status, note, created_at, generated_tests, bug:bugs(id, title), runner:automation_runners(name)",
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("bugs")
      .select("id, title, status")
      .eq("project_id", projectId)
      .in("status", ["open", "in_progress", "reopened"])
      .order("created_at", { ascending: false }),
    supabase
      .from("automation_reports")
      .select("id, version, run_id, status, created_at, runner, summary")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  return (
    <div className="space-y-4">
      <ProjectAutomation
        project={project}
        link={link ?? null}
        runners={(runners ?? []) as never}
        jobs={(jobs ?? []) as never}
        bugs={bugs ?? []}
        role={level}
        userId={userId}
      />
      {(project.house_slug || project.house_group) && (
        <AutotestReportList projectId={projectId} reports={(reports ?? []) as unknown as ReportListRow[]} />
      )}
    </div>
  );
}
