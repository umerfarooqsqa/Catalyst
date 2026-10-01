import { requireProfile, getProjects } from "@/lib/auth";
import { getCategories, getMembers } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import BugBoard from "@/components/BugBoard";
import { notFound } from "next/navigation";
import type { BugWithJoins } from "@/lib/types/models";

export const dynamic = "force-dynamic";

export default async function BugsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { userId, level } = await requireProfile();
  const supabase = await createClient();

  const [projects, categories, members, { data: bugs }, { data: requirements }, { data: projectRow }] =
    await Promise.all([
      getProjects(),
      getCategories(),
      getMembers(),
      supabase
        .from("bugs")
        .select(
          "*, assignee:profiles!bugs_assignee_id_fkey(id, full_name), category:bug_categories(id, name), requirement:requirements(id, title), release:releases(id, version), confirmer:profiles!bugs_version_confirmed_by_fkey(id, full_name)",
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      supabase
        .from("requirements")
        .select("id, title")
        .eq("project_id", projectId)
        .order("title"),
      supabase
        .from("projects")
        .select("house_group, platform, current_version, assigned_developer_id")
        .eq("id", projectId)
        .maybeSingle(),
    ]);

  // The app versions bugs can be filed under: the project's releases (newest first).
  const { data: releaseRows } = await supabase
    .from("releases")
    .select("id, version, release_notes_ref")
    .eq("project_id", projectId)
    .order("started_at", { ascending: false });
  const releases = (releaseRows ?? []).map((r) => ({ id: r.id, version: r.version, hasNotes: !!r.release_notes_ref }));

  const project = projects.find((p) => p.id === projectId);
  if (!project) notFound();

  // Android/iOS sibling of this house (same house_group, other platform), if
  // this house is platform-split -- lets the bug drawer offer "copy to X".
  let siblingProject: { id: string; name: string; platform: string } | null = null;
  if (projectRow?.house_group && projectRow.platform) {
    const { data } = await supabase
      .from("projects")
      .select("id, name, platform")
      .eq("house_group", projectRow.house_group)
      .neq("platform", projectRow.platform)
      .maybeSingle();
    siblingProject = data && data.platform ? { id: data.id, name: data.name, platform: data.platform } : null;
  }

  return (
    <BugBoard
      projectId={projectId}
      projectName={project.name}
      initialBugs={(bugs ?? []) as unknown as BugWithJoins[]}
      categories={categories}
      requirements={requirements ?? []}
      releases={releases}
      currentVersion={projectRow?.current_version ?? null}
      members={members}
      role={level}
      userId={userId}
      siblingProject={siblingProject}
      projectPlatform={projectRow?.platform ?? null}
      projectDeveloperId={projectRow?.assigned_developer_id ?? null}
    />
  );
}
