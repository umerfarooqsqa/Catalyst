import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A link to one bug that works from anywhere: notifications carry only the bug's id, so this looks up
 * its project and opens the bug there (the Bugs page opens the drawer for `?focus=`). The lookup runs
 * under the viewer's own session, so it only opens bugs RLS lets them see; anything else is a 404.
 */
export default async function BugLink({ params }: { params: Promise<{ bugId: string }> }) {
  await requireProfile();
  const { bugId } = await params;
  if (!UUID.test(bugId)) notFound();
  const supabase = await createClient();
  const { data: bug } = await supabase.from("bugs").select("project_id").eq("id", bugId).maybeSingle();
  if (!bug) notFound();
  redirect(`/projects/${bug.project_id}/bugs?focus=${bugId}`);
}
