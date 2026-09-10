import { notFound } from "next/navigation";
import { requireProfile, getProjects } from "@/lib/auth";
import { getMembers } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import TaskBoard from "@/components/TaskBoard";

export const dynamic = "force-dynamic";

export default async function TasksPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { userId, level } = await requireProfile();
  const supabase = await createClient();

  const [projects, members, { data: tasks }, { data: bugs }] = await Promise.all([
    getProjects(),
    getMembers(),
    supabase
      .from("tasks")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    supabase
      .from("bugs")
      .select("id, title")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
  ]);

  const project = projects.find((p) => p.id === projectId);
  if (!project) notFound();

  return (
    <TaskBoard
      projectId={projectId}
      projectName={project.name}
      initialTasks={tasks ?? []}
      members={members}
      bugs={bugs ?? []}
      role={level}
      userId={userId}
    />
  );
}
