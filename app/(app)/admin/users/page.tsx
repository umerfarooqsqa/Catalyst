import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, Card, Button, Badge, Input, Select, FormRow } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { updateUser, createUser, deleteUser } from "../actions";

export const dynamic = "force-dynamic";

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  created_at: string;
  roles: { label: string; level: string } | null;
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; pw?: string }>;
}) {
  const { userId } = await requireProfile();
  const { created, pw } = await searchParams;
  const supabase = await createClient();
  const [{ data: users }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, role, created_at, roles(label, level)")
      .order("created_at"),
    supabase.from("roles").select("key, label").order("sort_order"),
  ]);

  const rows = (users ?? []) as unknown as ProfileRow[];
  const roleOpts = roles ?? [];

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Add teammates, set their role, or remove access. New users get a one-time password shown here once."
      />

      {created && pw ? (
        <Card className="mb-6 border-brand-line bg-brand-soft p-4">
          <p className="text-[13px] font-medium text-brand-fg">
            Created {created}
          </p>
          <p className="mt-1 text-[13px] text-slate-700">
            One-time password (copy it now — it won&apos;t be shown again):{" "}
            <code className="rounded-sm bg-white px-1.5 py-0.5 font-mono text-[12px]">
              {pw}
            </code>
          </p>
        </Card>
      ) : null}

      <Card className="mb-6 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Add user</h2>
        <form
          action={createUser}
          className="flex flex-wrap items-end gap-3"
        >
          <FormRow label="Full name" className="min-w-[10rem] flex-1">
            <Input name="full_name" required placeholder="Jane Doe" />
          </FormRow>
          <FormRow label="Email" className="min-w-[12rem] flex-1">
            <Input name="email" type="email" required placeholder="jane@catalyst.pk" />
          </FormRow>
          <FormRow label="Role" className="min-w-[10rem]">
            <Select name="role" required defaultValue="">
              <option value="" disabled>
                Select…
              </option>
              {roleOpts.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </Select>
          </FormRow>
          <Button type="submit">Create</Button>
        </form>
      </Card>

      <div className="sheet-wrap rounded-sm border border-grid-line">
        <table className="sheet">
          <thead>
            <tr>
              <th className="min-w-[10rem]">Name</th>
              <th className="min-w-[12rem]">Email</th>
              <th className="min-w-[16rem]">Role</th>
              <th className="min-w-[8rem]">Joined</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="font-medium text-slate-800">
                  {u.full_name}
                  {u.id === userId ? (
                    <Badge tone="slate" className="ml-2">
                      you
                    </Badge>
                  ) : null}
                </td>
                <td className="text-slate-500">{u.email}</td>
                <td>
                  <form
                    action={updateUser}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="id" value={u.id} />
                    <Select
                      name="role"
                      defaultValue={u.role ?? ""}
                      className="max-w-[12rem]"
                    >
                      {roleOpts.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.label}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" variant="secondary">
                      Save
                    </Button>
                  </form>
                </td>
                <td className="text-slate-500">{fmtDate(u.created_at)}</td>
                <td className="text-right">
                  {u.id === userId ? null : (
                    <form action={deleteUser}>
                      <input type="hidden" name="id" value={u.id} />
                      <button className="text-xs text-slate-400 hover:text-red-600">
                        delete
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
