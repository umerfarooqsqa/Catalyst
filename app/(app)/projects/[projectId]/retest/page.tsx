import { notFound } from "next/navigation";
import { requireProfile, getProjects } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { canAdminister } from "@/lib/permissions";
import VersionGateCard from "@/components/VersionGateCard";
import RetestList from "@/components/RetestList";
import type { BugWithJoins } from "@/lib/types/models";

export const dynamic = "force-dynamic";

/**
 * REQ-14-adjacent: a dedicated place to run a retest pass for a release --
 * every bug currently "fixed" or "ready_for_retest" for this project (both
 * statuses mean "needs a retest," whether or not someone explicitly flagged
 * it ready yet), plus a shortcut to the same version-gate control from
 * Settings (set/parse the version you're retesting against without leaving
 * this page). Closing a bug once the fix is confirmed happens inline here
 * (RetestList); a failed retest still goes through the full bug drawer
 * (?focus=<id>, the same query param BugBoard already reads), since
 * reopening usually needs a comment explaining why, not just a status flip.
 */
export default async function RetestPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { level, userId } = await requireProfile();
  const projects = await getProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project) notFound();

  const supabase = await createClient();
  const [{ data: retestBugs }, { data: projectRow }] = await Promise.all([
    supabase
      .from("bugs")
      .select(
        "*, assignee:profiles!bugs_assignee_id_fkey(id, full_name), category:bug_categories(id, name), requirement:requirements(id, title), release:releases(id, version), confirmer:profiles!bugs_version_confirmed_by_fkey(id, full_name)",
      )
      .eq("project_id", projectId)
      .in("status", ["fixed", "ready_for_retest"])
      .order("updated_at", { ascending: false }),
    supabase
      .from("projects")
      .select("house_slug, house_group, current_version, release_notes_ref, notify_emails")
      .eq("id", projectId)
      .maybeSingle(),
  ]);

  const bugs = (retestBugs ?? []) as unknown as BugWithJoins[];

  return (
    <div>
      <PageHeader
        title="Retest"
        subtitle="Bugs marked “fixed” or “ready for retest” for this project, and the version you're retesting against."
      />

      {(projectRow?.house_slug || projectRow?.house_group) && canAdminister(level) && (
        <VersionGateCard
          projectId={projectId}
          houseSlug={(projectRow.house_slug ?? projectRow.house_group)!}
          initialVersion={projectRow.current_version ?? ""}
          initialReleaseNotesRef={projectRow.release_notes_ref ?? ""}
          initialNotifyEmails={(projectRow.notify_emails ?? []).join(", ")}
        />
      )}

      <RetestList projectId={projectId} bugs={bugs} role={level} userId={userId} />
    </div>
  );
}
