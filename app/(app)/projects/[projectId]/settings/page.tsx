import { redirect, notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { canAdminister } from "@/lib/permissions";
import DeleteProjectForm from "@/components/DeleteProjectForm";
import {
  addProjectMember,
  removeProjectMember,
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
      supabase.from("projects").select("id, name").eq("id", projectId).single(),
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
        subtitle="Members are used to route bug and task assignment. Everyone can already see every project; membership just narrows the assignee suggestions."
      />

      <Card className="mb-6 overflow-x-auto">
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
        <form action={addProjectMember} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="project_id" value={projectId} />
          <select
            name="user_id"
            required
            className="rounded-sm border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Select a user…</option>
            {nonMembers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name} ({u.email})
              </option>
            ))}
          </select>
          <button className="rounded-sm bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-fg">
            Add
          </button>
        </form>
      </Card>

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
