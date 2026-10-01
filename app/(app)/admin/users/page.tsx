import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, Card, Button, Badge, Input, Select, FormRow } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { DEV_RANKS, DEV_RANK_LABELS } from "@/lib/types/models";
import { updateUser, createUser, deleteUser, setUserPassword } from "../actions";

export const dynamic = "force-dynamic";

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  dev_rank: string | null;
  created_at: string;
  roles: { label: string; level: string } | null;
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    created?: string;
    pw?: string;
    pwset?: string;
  }>;
}) {
  const { userId } = await requireProfile();
  const { created, pw, pwset } = await searchParams;
  const supabase = await createClient();
  const [{ data: users }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, role, dev_rank, created_at, roles(label, level)")
      .order("created_at"),
    supabase.from("roles").select("key, label, level").order("sort_order"),
  ]);

  const rows = (users ?? []) as unknown as ProfileRow[];
  const roleOpts = roles ?? [];

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Add teammates, set their role, developer rank or password, or remove access. A lead developer can hand bugs and tasks assigned to them to a junior developer. Generated passwords are shown here once and never stored."
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

      {pwset ? (
        <Card className="mb-6 border-brand-line bg-brand-soft p-4">
          <p className="text-[13px] font-medium text-brand-fg">
            Password updated for {pwset}
          </p>
          {pw ? (
            <p className="mt-1 text-[13px] text-slate-700">
              New password (copy it now — it won&apos;t be shown again):{" "}
              <code className="rounded-sm bg-white px-1.5 py-0.5 font-mono text-[12px]">
                {pw}
              </code>
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-slate-600">
              Share it with them over a secure channel — it isn&apos;t stored
              anywhere and can&apos;t be shown again.
            </p>
          )}
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

      {/* Phones: one card per user (the table's role/password columns don't fit) */}
      <ul className="space-y-2 sm:hidden">
        {rows.map((u) => (
          <li key={u.id} className="rounded-md border border-grid-line bg-white p-3 shadow-card">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-slate-800">
                  {u.full_name}
                  {u.id === userId ? (
                    <Badge tone="slate" className="ml-2">
                      you
                    </Badge>
                  ) : null}
                </p>
                <p className="truncate text-xs text-slate-500">{u.email}</p>
                <p className="text-xs text-slate-400">Joined {fmtDate(u.created_at)}</p>
              </div>
              {u.id === userId ? null : <DeleteForm u={u} />}
            </div>
            <div className="mt-3 space-y-2">
              <RoleForm u={u} roleOpts={roleOpts} />
              <PasswordForm u={u} self={u.id === userId} />
            </div>
          </li>
        ))}
      </ul>

      <div className="sheet-wrap hidden rounded-sm border border-grid-line sm:block">
        <table className="sheet">
          <thead>
            <tr>
              <th className="min-w-[10rem]">Name</th>
              <th className="min-w-[12rem]">Email</th>
              <th className="min-w-[16rem]">Role</th>
              <th className="min-w-[14rem]">Password</th>
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
                  <RoleForm u={u} roleOpts={roleOpts} />
                </td>
                <td>
                  <PasswordForm u={u} self={u.id === userId} />
                </td>
                <td className="text-slate-500">{fmtDate(u.created_at)}</td>
                <td className="text-right">
                  {u.id === userId ? null : <DeleteForm u={u} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type RoleOpt = { key: string; label: string; level: string };

function RoleForm({ u, roleOpts }: { u: ProfileRow; roleOpts: RoleOpt[] }) {
  return (
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
      {/* Lead/junior applies to developer (contributor-level) roles only; saved as none otherwise. */}
      <Select
        name="dev_rank"
        defaultValue={u.dev_rank ?? ""}
        className="max-w-[11rem]"
        title="Developer rank (developer roles only)"
        aria-label="Developer rank"
      >
        <option value="">No dev rank</option>
        {DEV_RANKS.map((r) => (
          <option key={r} value={r}>
            {DEV_RANK_LABELS[r]}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="secondary">
        Save
      </Button>
    </form>
  );
}

function PasswordForm({ u, self }: { u: ProfileRow; self: boolean }) {
  return (
    <form
      action={setUserPassword}
      className="flex flex-wrap items-center gap-1.5"
    >
      <input type="hidden" name="id" value={u.id} />
      <Input
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        placeholder={
          self ? "New password" : "Set password"
        }
        className="max-w-[9rem]"
      />
      <Button type="submit" variant="secondary">
        Set
      </Button>
      <button
        type="submit"
        name="generate"
        value="1"
        formNoValidate
        className="text-xs text-slate-400 hover:text-brand-fg"
      >
        generate
      </button>
    </form>
  );
}

function DeleteForm({ u }: { u: ProfileRow }) {
  return (
    <form action={deleteUser}>
      <input type="hidden" name="id" value={u.id} />
      <button className="text-xs text-slate-400 hover:text-red-600">
        delete
      </button>
    </form>
  );
}
