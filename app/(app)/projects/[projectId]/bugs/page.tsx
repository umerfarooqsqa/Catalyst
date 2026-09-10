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

  const [projects, categories, members, { data: bugs }, { data: requirements }] =
    await Promise.all([
      getProjects(),
      getCategories(),
      getMembers(),
      supabase
        .from("bugs")
        .select(
          "*, assignee:profiles!bugs_assignee_id_fkey(id, full_name), category:bug_categories(id, name), requirement:requirements(id, title)",
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      supabase
        .from("requirements")
        .select("id, title")
        .eq("project_id", projectId)
        .order("title"),
    ]);

  const project = projects.find((p) => p.id === projectId);
  if (!project) notFound();

  return (
    <BugBoard
      projectId={projectId}
      projectName={project.name}
      initialBugs={(bugs ?? []) as unknown as BugWithJoins[]}
      categories={categories}
      requirements={requirements ?? []}
      members={members}
      role={level}
      userId={userId}
    />
  );
}
