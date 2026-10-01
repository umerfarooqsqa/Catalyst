import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A link to one task that works from anywhere (notifications carry only the task's id): looks up its
 * project and opens the task there (the Tasks page opens its drawer for `?focus=`). The lookup runs under
 * the viewer's own session, so a task RLS hides from them (0017: developers see only their own) is a 404.
 */
export default async function TaskLink({ params }: { params: Promise<{ taskId: string }> }) {
  await requireProfile();
  const { taskId } = await params;
  if (!UUID.test(taskId)) notFound();
  const supabase = await createClient();
  const { data: task } = await supabase.from("tasks").select("project_id").eq("id", taskId).maybeSingle();
  if (!task) notFound();
  redirect(`/projects/${task.project_id}/tasks?focus=${taskId}`);
}
