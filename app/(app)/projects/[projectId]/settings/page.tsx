import { redirect, notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { canAdminister } from "@/lib/permissions";
import DeleteProjectForm from "@/components/DeleteProjectForm";
import VersionGateCard from "@/components/VersionGateCard";
import {
  addProjectMember,
  removeProjectMember,
  updateProjectPlatform,
} from "@/app/(app)/projects/actions";

export const dynamic = "force-dynamic";

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { level } = await requireProfile();
  if (!canAdminister(level)) redirect(`/projects/${projectId}`);

  const supabase = await createClient();
  const [{ data: project }, { data: members }, { data: allUsers }] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, house_slug, house_group, platform, current_version, release_notes_ref, notify_emails")
        .eq("id", projectId)
        .single(),
      supabase
        .from("project_members")
        .select("user_id, profiles(full_name, email, role, roles(label))")
        .eq("project_id", projectId),
      supabase
        .from("profiles")
        .select("id, full_name, email")
        .order("full_name"),
    ]);

  if (!project) notFound();

  type MemberRow = {
    user_id: string;
    profiles: {
      full_name: string | null;
      email: string | null;
      role: string | null;
      roles: { label: string } | null;
    } | null;
  };
  const rows = (members ?? []) as unknown as MemberRow[];
  const memberIds = new Set(rows.map((m) => m.user_id));
  const nonMembers = (allUsers ?? []).filter((u) => !memberIds.has(u.id));

  return (
    <div>
      <PageHeader
        title="Project settings"
        subtitle="Members are used to route bug and task assignment. Membership narrows the assignee suggestions; who can see the project is set by each role's platform (Admin → Roles)."
      />

      {/* Mobile: member cards with touch-sized remove buttons */}
      <ul className="mb-6 space-y-2 sm:hidden">
        {rows.map((m) => (
          <li
            key={m.user_id}
            className="flex items-center justify-between gap-3 rounded-lg border border-grid-line bg-white p-3 shadow-sm"
          >
            <div className="min-w-0">
              <div className="truncate font-medium text-slate-800">
                {m.profiles?.full_name}
              </div>
              <div className="truncate text-xs text-slate-500">
                {m.profiles?.email}
              </div>
              <div className="mt-0.5 text-xs text-slate-600">
                {m.profiles?.roles?.label ?? m.profiles?.role ?? "—"}
              </div>
            </div>
            <form action={removeProjectMember} className="shrink-0">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="user_id" value={m.user_id} />
              <button className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition active:scale-95 hover:border-red-300 hover:text-red-600">
                Remove
              </button>
            </form>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="rounded-lg border border-dashed border-grid-line p-4 text-sm text-slate-400">
            No members yet.
          </li>
        )}
      </ul>

      {/* Desktop: dense table */}
      <Card className="mb-6 hidden overflow-x-auto sm:block">
        <table className="min-w-full text-sm">
          <thead className="border-b border-grid-line bg-grid-head text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Member</th>
              <th className="px-3 py-2 text-left font-medium">Role</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-grid-line">
            {rows.map((m) => (
              <tr key={m.user_id}>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-800">
                    {m.profiles?.full_name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {m.profiles?.email}
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {m.profiles?.roles?.label ?? m.profiles?.role ?? "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <form action={removeProjectMember}>
                    <input type="hidden" name="project_id" value={projectId} />
                    <input type="hidden" name="user_id" value={m.user_id} />
                    <button className="text-xs text-slate-400 hover:text-red-600">
                      remove
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-sm text-slate-400">
                  No members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Add member</h2>
        <form
          action={addProjectMember}
          className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <input type="hidden" name="project_id" value={projectId} />
          <select
            name="user_id"
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm sm:w-auto"
          >
            <option value="">Select a user…</option>
            {nonMembers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name} ({u.email})
              </option>
            ))}
          </select>
          <button className="w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-white transition active:scale-95 hover:bg-brand-fg sm:w-auto">
            Add member
          </button>
        </form>
      </Card>

      <Card className="mt-6 p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Platform</h2>
        <p className="mb-3 text-xs text-slate-500">
          Decides which Master Bug Library list this project connects to: Android
          projects pull from the Android list, iOS projects from the iOS list.
        </p>
        {project.house_group || project.house_slug ? (
          <p className="text-sm text-slate-600">
            <b>{project.platform === "ios" ? "iOS" : "Android"}</b> — part of a
            house&apos;s Android/iOS pair, so this can&apos;t be changed here.
          </p>
        ) : (
          <form
            action={updateProjectPlatform}
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
          >
            <input type="hidden" name="project_id" value={project.id} />
            <select
              key={project.platform ?? "unset"} // remount so the saved value shows after the action
              name="platform"
              defaultValue={project.platform ?? ""}
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm sm:w-48"
            >
              <option value="" disabled>
                Not set
              </option>
              <option value="android">Android</option>
              <option value="ios">iOS</option>
            </select>
            <button className="w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-white transition active:scale-95 hover:bg-brand-fg sm:w-auto">
              Save platform
            </button>
          </form>
        )}
      </Card>

      {(project.house_slug || project.house_group) && (
        <VersionGateCard
          projectId={project.id}
          houseSlug={(project.house_slug ?? project.house_group)!}
          initialVersion={project.current_version ?? ""}
          initialReleaseNotesRef={project.release_notes_ref ?? ""}
          initialNotifyEmails={(project.notify_emails ?? []).join(", ")}
        />
      )}

      <Card className="mt-6 border-red-200 p-4">
        <h2 className="mb-3 text-sm font-semibold text-red-700">Danger zone</h2>
        <DeleteProjectForm
          projectId={project.id}
          projectName={project.name}
        />
      </Card>
    </div>
  );
}
