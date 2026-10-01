import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, parsePlatform, resolveProject } from "@/lib/automation-release";
import type { Database } from "@/lib/types/database";

type BugStatus = Database["public"]["Enums"]["bug_status"];
const BUG_STATUSES: BugStatus[] = [
  "open",
  "in_progress",
  "fixed",
  "ready_for_retest",
  "reopened",
  "closed",
];

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only bug export for the aktrade automation side (REQ-4/6/14): given a
 * house slug (or a specific bug id), returns bugs with their full
 * reproduction steps so a QA engineer/Claude Code session has everything
 * needed to write the matching automation test case without digging through
 * the portal UI by hand.
 *
 * Auth: shared-secret header (`x-automation-secret`), not a user session —
 * this is called from the Python side, which has no catalyst login. See
 * serviceRoleClient()'s doc-comment for why this pattern is used.
 */
function checkSecret(req: Request): NextResponse | null {
  const expected = process.env.AUTOMATION_INGEST_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "AUTOMATION_INGEST_SECRET is not configured on this deployment" },
      { status: 503 },
    );
  }
  const provided = req.headers.get("x-automation-secret");
  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

const BUG_COLUMNS =
  "id, title, description, steps_to_reproduce, severity, priority, status, created_at, updated_at, category:bug_categories(name), project:projects(name, house_slug, house_group, platform)";

export async function GET(req: Request) {
  const authError = checkSecret(req);
  if (authError) return authError;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const house = url.searchParams.get("house");
  const statusParam = url.searchParams.get("status"); // optional: open|in_progress|fixed|ready_for_retest|reopened|closed

  const supabase = serviceRoleClient();

  if (id) {
    const { data, error } = await supabase
      .from("bugs")
      .select(BUG_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Bug not found" }, { status: 404 });
    return NextResponse.json({ bug: data });
  }

  if (!house) {
    return NextResponse.json(
      { error: "Provide either 'id' or 'house' as a query parameter" },
      { status: 400 },
    );
  }
  if (statusParam && !BUG_STATUSES.includes(statusParam as BugStatus)) {
    return NextResponse.json(
      { error: `'status' must be one of: ${BUG_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }
  const status = statusParam as BugStatus | null;

  const platform = parsePlatform(url.searchParams.get("platform"));
  if (!platform) return badPlatform();
  const found = await resolveProject(house, platform);
  if (!found.project) return NextResponse.json({ error: found.error }, { status: found.status });
  const project = found.project;

  let query = supabase
    .from("bugs")
    .select(BUG_COLUMNS)
    .eq("project_id", project.id)
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data: bugs, error: bugsErr } = await query;
  if (bugsErr) return NextResponse.json({ error: bugsErr.message }, { status: 500 });

  return NextResponse.json({ project: project.name, house_slug: house, platform, bugs: bugs ?? [] });
}
