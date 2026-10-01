import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Button, Input, Select, Textarea } from "@/components/ui";
import { SEVERITY_LABELS } from "@/lib/severity";
import { SEVERITIES } from "@/lib/types/models";
import { getRoleCategories } from "@/lib/data";
import type { RoleCategory } from "@/lib/types/models";
import { saveCategory } from "../actions";

export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  const supabase = await createClient();
  const [{ data: cats }, roleCats] = await Promise.all([
    supabase.from("bug_categories").select("*").order("name"),
    getRoleCategories(),
  ]);

  return (
    <div>
      <PageHeader
        title="Bug categories"
        subtitle="Templates: default severity + pre-filled steps. Keyword hints drive the severity suggestion, and with 'Usually' the role-category suggestion."
      />

      <Card className="mb-6 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">New category</h2>
        <CategoryForm roleCats={roleCats} />
      </Card>

      <div className="space-y-4">
        {(cats ?? []).map((c) => (
          <Card key={c.id} className="p-4">
            <CategoryForm
              roleCats={roleCats}
              id={c.id}
              name={c.name}
              defaultSeverity={c.default_severity ?? "minor"}
              defaultArea={c.default_area ?? ""}
              templateSteps={c.template_steps ?? ""}
              keywordHints={(c.keyword_hints ?? []).join(", ")}
            />
          </Card>
        ))}
      </div>
    </div>
  );
}

function CategoryForm({
  roleCats,
  id,
  name = "",
  defaultSeverity = "minor",
  defaultArea = "",
  templateSteps = "",
  keywordHints = "",
}: {
  roleCats: RoleCategory[];
  id?: string;
  name?: string;
  defaultSeverity?: string;
  defaultArea?: string;
  templateSteps?: string;
  keywordHints?: string;
}) {
  return (
    <form action={saveCategory} className="space-y-2">
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <div className="flex flex-wrap gap-2">
        <Input
          name="name"
          defaultValue={name}
          placeholder="Category name"
          required
          className="flex-1"
        />
        <Select
          name="default_severity"
          defaultValue={defaultSeverity}
          className="w-40"
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select name="default_area" defaultValue={defaultArea} className="w-52" title="The role category bugs of this kind usually belong to">
          <option value="">Usually: any role category</option>
          {roleCats.map((c) => (
            <option key={c.key} value={c.key}>
              Usually: {c.label}
            </option>
          ))}
        </Select>
      </div>
      <Input
        name="keyword_hints"
        defaultValue={keywordHints}
        placeholder="keyword hints, comma, separated (e.g. crash, data loss)"
      />
      <Textarea
        name="template_steps"
        defaultValue={templateSteps}
        rows={4}
        placeholder="Template steps to reproduce"
        className="font-mono text-xs"
      />
      <Button type="submit">{id ? "Save changes" : "Add category"}</Button>
    </form>
  );
}
