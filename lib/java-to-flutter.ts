/**
 * The Bug Library's "Java to Flutter" list (migration 0071): QA/admin send a project's bug there from
 * the bug drawer or a bug card. The entry is a copy (no live link, like every library copy) that keeps
 * the project's platform and remembers the bug and project it came from. A bug goes there once
 * (unique index); RLS base_page_qa_insert lets only QA/admin write.
 */
import type { createClient } from "@/lib/supabase/client";
import type { Bug } from "@/lib/types/models";

export const J2F = "java_to_flutter";

type Client = ReturnType<typeof createClient>;
type SendableBug = Pick<
  Bug,
  "id" | "project_id" | "title" | "description" | "steps_to_reproduce" | "severity" | "area" | "category_id"
>;

/** Copies the bug into the list. Already there (e.g. sent from another tab) counts as sent. */
export async function sendBugToJ2f(
  supabase: Client,
  bug: SendableBug,
  platform: string | null,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("base_page").insert({
    source_type: "master_bug",
    collection: J2F,
    platform,
    title: bug.title,
    description: bug.description,
    steps_to_reproduce: bug.steps_to_reproduce,
    severity: bug.severity,
    area: bug.area,
    category_id: bug.category_id,
    created_by: userId,
    source_bug_id: bug.id,
    source_project_id: bug.project_id,
  });
  if (!error || error.code === "23505") return { ok: true };
  return { ok: false, error: error.message };
}

/** The ids of this project's bugs that are already in the list. */
export async function bugsSentToJ2f(supabase: Client, projectId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("base_page")
    .select("source_bug_id")
    .eq("collection", J2F)
    .eq("source_project_id", projectId);
  return new Set((data ?? []).map((r) => r.source_bug_id).filter((x): x is string => !!x));
}
