import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Button, Input, Select, FormRow, Textarea } from "@/components/ui";
import { CATEGORY_COLORS, colorClass, skillsOf } from "@/lib/bug-area";
import type { RoleCategory } from "@/lib/types/models";
import { saveRoleCategory, deleteRoleCategory, setRoleCategoryMember } from "../actions";

export const dynamic = "force-dynamic";

type Person = {
  id: string;
  full_name: string;
  skills: string[] | null;
  roles: { label: string; level: string; platform: string | null; assignable: boolean } | null;
};

/**
 * Admin -> Role categories (migration 0043): the work areas bugs and tasks are filed
 * under (frontend, backend, database, DevOps, ...). Each has keywords for the
 * suggestion and the people in it. A new task with a category goes to the least
 * busy person in it; a new bug to the project's person for it, else the least busy.
 */
export default async function RoleCategoriesPage() {
  const supabase = await createClient();
  const [{ data: cats }, { data: people }, { data: openTasks }, { data: openBugs }, { data: usedBugs }, { data: usedTasks }] =
    await Promise.all([
      supabase.from("role_categories").select("*").order("sort_order").order("label"),
      supabase.from("profiles").select("id, full_name, skills, roles(label, level, platform, assignable)").order("full_name"),
      supabase.from("tasks").select("assignee_id").neq("status", "done").not("assignee_id", "is", null),
      supabase
        .from("bugs")
        .select("assignee_id")
        .not("status", "in", "(fixed,ready_for_retest,closed)")
        .not("assignee_id", "is", null),
      supabase.from("bugs").select("area").not("area", "is", null),
      supabase.from("tasks").select("area").not("area", "is", null),
    ]);

  const persons = ((people ?? []) as unknown as Person[]).filter((p) => p.roles?.level !== "viewer");
  // Open work per person, the same count the auto-assignment uses.
  const load = new Map<string, number>();
  for (const r of [...(openTasks ?? []), ...(openBugs ?? [])]) {
    if (r.assignee_id) load.set(r.assignee_id, (load.get(r.assignee_id) ?? 0) + 1);
  }
  const used = new Map<string, number>();
  for (const r of [...(usedBugs ?? []), ...(usedTasks ?? [])]) {
    if (r.area) used.set(r.area, (used.get(r.area) ?? 0) + 1);
  }

  return (
    <div>
      <PageHeader
        title="Role categories"
        subtitle="The work areas bugs and tasks are filed under. Put people in the categories they work in (one person can be in several). A category that spans Android and iOS (backend, DBA) lets its people work on both platforms. A new task goes to the least busy person in its category; a new bug to the project's person for it, else the least busy person in it. Keywords drive the category suggestion when someone logs a bug or task."
      />

      <Card className="mb-6 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">New role category</h2>
        <CategoryForm />
      </Card>

      <div className="space-y-4">
        {(cats ?? []).map((c) => {
          const members = persons.filter((p) => skillsOf(p.skills).includes(c.key));
          const others = persons.filter((p) => !members.includes(p) && p.roles?.assignable !== false);
          const nextUp = [...members]
            .filter((p) => p.roles?.assignable !== false)
            .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.full_name.localeCompare(b.full_name))[0];
          return (
            <Card key={c.id} className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${colorClass(c.color)}`}>
                  {c.short_label}
                </span>
                <h2 className="font-semibold text-slate-800">{c.label}</h2>
                {c.all_platforms && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600" title="Its people work on Android and iOS projects alike, whatever their role's platform">
                    Android + iOS
                  </span>
                )}
                <span className="text-xs text-slate-400">
                  key: {c.key} · used by {used.get(c.key) ?? 0} bug(s) and task(s)
                </span>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
                <div className="min-w-0">
                  <CategoryForm cat={c} />
                </div>

                <div className="min-w-0 space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    People ({members.length})
                  </h3>
                  {members.length === 0 ? (
                    <p className="text-[13px] text-slate-500">
                      Nobody yet. Until someone is added, its tasks stay unassigned and its bugs go to the project&apos;s
                      developer.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {members.map((p) => (
                        <li key={p.id} className="flex items-center gap-2 text-[13px]">
                          <span className="min-w-0 flex-1 truncate text-slate-800">
                            {p.full_name}
                            {p.roles?.label ? <span className="text-slate-400"> · {p.roles.label}</span> : null}
                          </span>
                          <span className="whitespace-nowrap text-xs text-slate-500 tabular-nums">
                            {load.get(p.id) ?? 0} open
                          </span>
                          {nextUp?.id === p.id && (
                            <span className="whitespace-nowrap rounded-full bg-green-50 px-1.5 py-0.5 text-[11px] text-green-700" title="Least busy: the next task in this category goes to them (if they can see the project)">
                              next up
                            </span>
                          )}
                          <form action={setRoleCategoryMember}>
                            <input type="hidden" name="key" value={c.key} />
                            <input type="hidden" name="user_id" value={p.id} />
                            <input type="hidden" name="op" value="remove" />
                            <button className="text-xs text-slate-400 hover:text-red-600" title={`Take ${p.full_name} out of ${c.short_label}`}>
                              remove
                            </button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}
                  {others.length > 0 && (
                    <form action={setRoleCategoryMember} className="flex items-center gap-2">
                      <input type="hidden" name="key" value={c.key} />
                      <input type="hidden" name="op" value="add" />
                      <Select name="user_id" required defaultValue="" className="min-w-0 flex-1" aria-label={`Add a person to ${c.short_label}`}>
                        <option value="" disabled>
                          Add a person…
                        </option>
                        {others.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.full_name}
                            {p.roles?.label ? ` · ${p.roles.label}` : ""}
                          </option>
                        ))}
                      </Select>
                      <Button type="submit" variant="secondary">
                        Add
                      </Button>
                    </form>
                  )}
                </div>
              </div>

              <details className="mt-3 text-[13px]">
                <summary className="cursor-pointer text-slate-400 hover:text-red-600">Delete this category…</summary>
                <form action={deleteRoleCategory} className="mt-2 flex flex-wrap items-center gap-3 rounded-md bg-red-50 p-3">
                  <input type="hidden" name="id" value={c.id} />
                  <label className="flex items-center gap-1.5 text-red-800">
                    <input type="checkbox" name="confirm" required />
                    Delete {c.label}: its {used.get(c.key) ?? 0} bug(s) and task(s) become &ldquo;not set&rdquo;, and{" "}
                    {members.length} person(s) leave it.
                  </label>
                  <Button type="submit" variant="danger">
                    Delete
                  </Button>
                </form>
              </details>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function CategoryForm({ cat }: { cat?: RoleCategory }) {
  return (
    <form action={saveRoleCategory} className="space-y-3">
      {cat ? <input type="hidden" name="id" value={cat.id} /> : null}
      <div className="flex flex-wrap items-start gap-3">
        <FormRow label="Name" className="min-w-[12rem] flex-1">
          <Input name="label" defaultValue={cat?.label ?? ""} placeholder="e.g. UI/UX design" required />
        </FormRow>
        <FormRow label="Short name" className="w-36" hint={cat ? undefined : "badges; the key comes from it"}>
          <Input name="short_label" defaultValue={cat?.short_label ?? ""} placeholder="e.g. UI/UX" />
        </FormRow>
        <FormRow label="Colour" className="w-32">
          <Select name="color" defaultValue={cat?.color ?? "slate"}>
            {Object.keys(CATEGORY_COLORS).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </FormRow>
        <FormRow label="Order" className="w-20">
          <Input name="sort_order" type="number" defaultValue={cat?.sort_order ?? 100} />
        </FormRow>
      </div>
      <FormRow label="What it covers">
        <Input
          name="description"
          defaultValue={cat?.description ?? ""}
          placeholder="Shown when picking a category, e.g. Screens, mockups and user flows."
        />
      </FormRow>
      <FormRow label="Keywords (comma or new line separated)" hint="A bug or task whose text has these words is suggested this category; phrases count double.">
        <Textarea
          name="keywords"
          rows={2}
          defaultValue={(cat?.keywords ?? []).join(", ")}
          placeholder="mockup, figma, wireframe, user flow"
          className="text-xs"
        />
      </FormRow>
      <label className="flex items-start gap-2 text-[13px] text-slate-700">
        <input type="checkbox" name="all_platforms" defaultChecked={cat?.all_platforms ?? false} className="mt-0.5" />
        <span>
          Spans Android and iOS: its people work on every platform&apos;s projects (and can see them), whatever their
          role&apos;s platform. On for work like backend and DBA; off for platform-specific work like frontend.
        </span>
      </label>
      <Button type="submit">{cat ? "Save changes" : "Add category"}</Button>
    </form>
  );
}
