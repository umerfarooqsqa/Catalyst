import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Button, Badge, Input, Select, FormRow } from "@/components/ui";
import { ROLE_LEVELS, ROLE_LEVEL_LABELS } from "@/lib/types/models";
import type { RoleRow } from "@/lib/types/models";
import { saveRole, deleteRole } from "../actions";

export const dynamic = "force-dynamic";

export default async function AdminRolesPage() {
  const supabase = await createClient();
  const [{ data: roles }, { data: profiles }] = await Promise.all([
    supabase.from("roles").select("*").order("sort_order"),
    supabase.from("profiles").select("role"),
  ]);

  const counts = new Map<string, number>();
  for (const p of profiles ?? []) {
    if (p.role) counts.set(p.role, (counts.get(p.role) ?? 0) + 1);
  }

  return (
    <div>
      <PageHeader
        title="Roles"
        subtitle="Every role carries one permission level. Add the roles your team actually uses (Android, iOS, Backoffice…) — the level decides what they can do."
      />

      <Card className="mb-6 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">New role</h2>
        <RoleForm />
      </Card>

      <div className="space-y-3">
        {(roles ?? []).map((r) => (
          <Card key={r.id} className="p-4">
            <RoleForm role={r} userCount={counts.get(r.key) ?? 0} />
          </Card>
        ))}
      </div>
    </div>
  );
}

function RoleForm({
  role,
  userCount = 0,
}: {
  role?: RoleRow;
  userCount?: number;
}) {
  const editing = !!role;
  return (
    <form action={saveRole} className="space-y-3">
      {editing ? <input type="hidden" name="id" value={role.id} /> : null}

      <div className="flex flex-wrap items-start gap-3">
        <FormRow
          label="Label"
          className="min-w-[10rem] flex-1"
          hint={editing ? `key: ${role.key}` : "the key is derived once"}
        >
          <Input
            name="label"
            defaultValue={role?.label ?? ""}
            placeholder="e.g. Android"
            required
          />
        </FormRow>

        <FormRow label="Permission level" className="min-w-[14rem]">
          <Select name="level" defaultValue={role?.level ?? "contributor"}>
            {ROLE_LEVELS.map((l) => (
              <option key={l} value={l}>
                {ROLE_LEVEL_LABELS[l]}
              </option>
            ))}
          </Select>
        </FormRow>

        <FormRow label="Sort" className="w-20">
          <Input
            name="sort_order"
            type="number"
            defaultValue={role?.sort_order ?? 100}
          />
        </FormRow>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-1.5 text-[13px] text-slate-700">
          <input
            type="checkbox"
            name="assignable"
            defaultChecked={role?.assignable ?? true}
          />
          Appears in assignee lists
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-slate-700">
          <input
            type="checkbox"
            name="is_default"
            defaultChecked={role?.is_default ?? false}
          />
          Default for new sign-ups
        </label>
        {editing ? (
          <span className="text-xs text-slate-400">
            {userCount} user{userCount === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit">{editing ? "Save changes" : "Add role"}</Button>
        {editing && !role.is_default ? (
          <Button
            formAction={deleteRole}
            variant="ghost"
            className="text-red-600 hover:bg-red-50"
          >
            Delete
          </Button>
        ) : null}
        {editing && role.is_default ? (
          <Badge tone="green">Default</Badge>
        ) : null}
      </div>
    </form>
  );
}
