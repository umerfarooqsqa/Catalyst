import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform } from "@/lib/automation-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every bug of every project on one platform (default android), whatever the
 * house -- including projects with no app linked. The runner turns them into
 * ONE shared test suite (the white-label apps share a UI), deduplicating bugs
 * that were copied between projects. Read-only, shared-secret auth.
 */
const COLUMNS =
  "id, title, description, steps_to_reproduce, severity, priority, status, created_at, updated_at, base_page_id, " +
  "category:bug_categories(name), project:projects!inner(id, name, house_slug, house_group, platform)";

export async function GET(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;

  const url = new URL(req.url);
  const platform = parsePlatform(url.searchParams.get("platform"));
  if (!platform) return badPlatform();

  const supabase = serviceRoleClient();
  const bugs: unknown[] = [];
  const PAGE = 500;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("bugs")
      .select(COLUMNS)
      .eq("project.platform", platform)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    bugs.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return NextResponse.json({ platform, bugs });
}
