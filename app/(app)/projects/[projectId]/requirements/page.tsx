import { requireProfile } from "@/lib/auth";
import { getCategories } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import RequirementsView from "@/components/RequirementsView";
import RequirementDocsPanel from "@/components/RequirementDocsPanel";

export const dynamic = "force-dynamic";

export default async function RequirementsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { userId, level } = await requireProfile();
  const supabase = await createClient();

  const [
    { data: reqs },
    { data: bugs },
    { data: docs },
    { data: extracted },
    categories,
  ] = await Promise.all([
    supabase
      .from("requirements")
      .select(
        "id, title, description, status, test_cases(id, title, steps, expected_result, status)",
      )
      .eq("project_id", projectId)
      .order("title"),
    supabase
      .from("bugs")
      .select("id, title, severity, status, requirement_id")
      .eq("project_id", projectId),
    supabase
      .from("requirement_documents")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    supabase
      .from("base_page")
      .select("*")
      .eq("source_type", "client_requirement")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    getCategories(),
  ]);

  const byReq = new Map<string, typeof bugs>();
  for (const b of bugs ?? []) {
    if (!b.requirement_id) continue;
    const list = byReq.get(b.requirement_id) ?? [];
    list.push(b);
    byReq.set(b.requirement_id, list);
  }

  const requirements = (reqs ?? []).map((r) => ({
    ...r,
    test_cases: r.test_cases ?? [],
    bugs: (byReq.get(r.id) ?? []).map((b) => ({
      id: b!.id,
      title: b!.title,
      severity: b!.severity,
      status: b!.status,
    })),
  }));

  return (
    <div>
      <PageHeader title="Requirements & Traceability" />
      <RequirementDocsPanel
        projectId={projectId}
        docs={docs ?? []}
        extracted={extracted ?? []}
        categories={categories ?? []}
        role={level}
        userId={userId}
      />
      <RequirementsView
        projectId={projectId}
        requirements={requirements}
        role={level}
        userId={userId}
      />
    </div>
  );
}
